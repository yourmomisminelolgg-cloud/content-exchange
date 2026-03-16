const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { sendWelcomePremiumEmail } = require('../middleware/email');

const CREDIT_PACKAGES = [
  { id: 'starter', name: 'Starter Pack', credits: 100, price: 4.99, popular: false, bonus: 0 },
  { id: 'growth', name: 'Growth Pack', credits: 500, price: 19.99, popular: true, bonus: 50 },
  { id: 'pro', name: 'Pro Pack', credits: 1000, price: 34.99, popular: false, bonus: 150 },
  { id: 'ultimate', name: 'Ultimate Pack', credits: 2500, price: 79.99, popular: false, bonus: 500 },
];

router.get('/packages', (req, res) => {
  res.json({ packages: CREDIT_PACKAGES });
});

// Create PayPal order
router.post('/create-order', requireAuth, async (req, res) => {
  const { package_id } = req.body;
  const pkg = CREDIT_PACKAGES.find(p => p.id === package_id);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
  const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    return res.status(500).json({ error: 'PayPal not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env' });
  }

  try {
    // Get access token
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Failed to get PayPal token');

    // Create order
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: pkg.price.toFixed(2) },
          description: `Content Exchange - ${pkg.name} (${pkg.credits + pkg.bonus} credits)`,
        }],
        application_context: {
          brand_name: 'Content Exchange',
          return_url: `${process.env.APP_URL || 'http://localhost:3000'}/payment/success`,
          cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/payment/cancel`,
        }
      }),
    });

    const orderData = await orderRes.json();
    if (!orderData.id) throw new Error('Failed to create PayPal order');

    // Store pending purchase
    const purchaseId = uuidv4();
    db.prepare(`
      INSERT INTO credit_purchases (id, user_id, package_id, credits, amount_usd, paypal_order_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(purchaseId, req.user.id, pkg.id, pkg.credits + pkg.bonus, pkg.price, orderData.id);

    res.json({ orderId: orderData.id, purchaseId });
  } catch (err) {
    console.error('PayPal error:', err);
    res.status(500).json({ error: 'Payment processing error: ' + err.message });
  }
});

// Capture PayPal order (after user approves)
router.post('/capture-order', requireAuth, async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID required' });

  const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
  const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const purchase = db.prepare('SELECT * FROM credit_purchases WHERE paypal_order_id = ? AND user_id = ?').get(orderId, req.user.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  if (purchase.status === 'completed') return res.status(400).json({ error: 'Already processed' });

  try {
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();

    const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const captureData = await captureRes.json();

    if (captureData.status === 'COMPLETED') {
      const pkg = CREDIT_PACKAGES.find(p => p.id === purchase.package_id);
      db.prepare('UPDATE credit_purchases SET status = ?, paypal_payment_id = ? WHERE id = ?')
        .run('completed', captureData.id, purchase.id);
      db.prepare('UPDATE users SET credits = credits + ?, is_premium = 1 WHERE id = ?').run(purchase.credits, req.user.id);
      db.prepare('INSERT INTO transactions (id, user_id, type, amount, description, reference) VALUES (?, ?, ?, ?, ?, ?)').run(
        uuidv4(), req.user.id, 'purchase', purchase.credits, `Purchased ${pkg?.name || 'credit pack'}`, purchase.id
      );
      db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), req.user.id, 'credit', '⭐ Purchase Complete!', `${purchase.credits} credits added to your account!`
      );

      const user = db.prepare('SELECT email, username FROM users WHERE id = ?').get(req.user.id);
      try { sendWelcomePremiumEmail(user.email, user.username, pkg?.name || 'credit pack'); } catch (e) {}

      res.json({ success: true, credits: purchase.credits });
    } else {
      res.status(400).json({ error: 'Payment not completed', status: captureData.status });
    }
  } catch (err) {
    console.error('Capture error:', err);
    res.status(500).json({ error: 'Payment capture failed: ' + err.message });
  }
});

module.exports = router;
