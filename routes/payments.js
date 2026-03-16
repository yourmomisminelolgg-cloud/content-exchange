const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const db = require('../database/db');
const auth = require('../middleware/auth');

const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalAccessToken() {
  const creds = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

// GET /api/payments/packages
router.get('/packages', auth, (req, res) => {
  const packages = db.prepare('SELECT * FROM credit_packages WHERE is_active = 1 ORDER BY price_usd ASC').all();
  res.json(packages);
});

// GET /api/payments/history
router.get('/history', auth, (req, res) => {
  const history = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json(history);
});

// POST /api/payments/create-order
router.post('/create-order', auth, async (req, res) => {
  const { packageId } = req.body;
  const pkg = db.prepare('SELECT * FROM credit_packages WHERE id = ? AND is_active = 1').get(packageId);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  try {
    const accessToken = await getPayPalAccessToken();
    const totalCredits = pkg.credits + pkg.bonus_credits;

    const order = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: pkg.price_usd.toFixed(2) },
          description: `Content Exchange - ${pkg.name} Package (${totalCredits} credits)`
        }],
        application_context: {
          return_url: `${process.env.APP_URL}/?payment=success`,
          cancel_url: `${process.env.APP_URL}/?payment=cancelled`,
          brand_name: 'Content Exchange',
          user_action: 'PAY_NOW'
        }
      })
    });

    const orderData = await order.json();
    if (!orderData.id) return res.status(500).json({ error: 'PayPal order creation failed', details: orderData });

    // Save pending order
    db.prepare('INSERT INTO paypal_orders (user_id, order_id, package_id, amount_usd, credits) VALUES (?,?,?,?,?)').run(
      req.user.id, orderData.id, packageId, pkg.price_usd, totalCredits
    );

    res.json({ orderId: orderData.id });
  } catch (err) {
    console.error('PayPal error:', err);
    res.status(500).json({ error: 'Payment service unavailable' });
  }
});

// POST /api/payments/capture-order
router.post('/capture-order', auth, async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID required' });

  // Verify order belongs to this user and is pending
  const pendingOrder = db.prepare("SELECT * FROM paypal_orders WHERE order_id = ? AND user_id = ? AND status = 'pending'").get(orderId, req.user.id);
  if (!pendingOrder) return res.status(400).json({ error: 'Order not found or already processed' });

  try {
    const accessToken = await getPayPalAccessToken();
    const capture = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    const captureData = await capture.json();

    if (captureData.status === 'COMPLETED') {
      const credits = pendingOrder.credits;
      db.prepare("UPDATE paypal_orders SET status = 'completed', captured_at = CURRENT_TIMESTAMP WHERE order_id = ?").run(orderId);
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(credits, req.user.id);
      const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
      db.prepare('INSERT INTO transactions (user_id, type, amount, description, reference, balance_after) VALUES (?,?,?,?,?,?)').run(
        req.user.id, 'purchase', credits, `Purchased ${credits} credits via PayPal`, orderId, user.credits
      );
      db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
        req.user.id, 'purchase', '💳 Credits Added!', `Successfully added ${credits} credits to your account!`
      );

      res.json({ success: true, credits, newBalance: user.credits });
    } else {
      db.prepare("UPDATE paypal_orders SET status = 'failed' WHERE order_id = ?").run(orderId);
      res.status(400).json({ error: 'Payment not completed', status: captureData.status });
    }
  } catch (err) {
    console.error('PayPal capture error:', err);
    res.status(500).json({ error: 'Capture failed' });
  }
});

module.exports = router;
