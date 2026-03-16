const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@contentexchange.io';
const APP_NAME = 'Content Exchange';

const emailStyles = `
  font-family: 'Segoe UI', Arial, sans-serif;
  background: #f8f9fa;
  padding: 40px 20px;
`;

const cardStyles = `
  background: white;
  border-radius: 12px;
  padding: 40px;
  max-width: 560px;
  margin: 0 auto;
  box-shadow: 0 2px 20px rgba(0,0,0,0.08);
`;

const btnStyles = `
  display: inline-block;
  background: #2563eb;
  color: white;
  padding: 14px 32px;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 600;
  font-size: 15px;
  margin: 24px 0;
`;

const sendVerificationEmail = async (email, username, token) => {
  const link = `${APP_URL}/verify-email?token=${token}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${cardStyles}">
        <h1 style="color:#111;font-size:24px;margin:0 0 8px">Welcome to ${APP_NAME} 👋</h1>
        <p style="color:#555;font-size:15px;line-height:1.6">Hi ${username}, you're almost in. Please verify your email address to activate your account and start earning credits.</p>
        <a href="${link}" style="${btnStyles}">Verify Email Address</a>
        <p style="color:#888;font-size:13px">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#aaa;font-size:12px">${APP_NAME} · The Creator Growth Platform</p>
      </div>
    </div>
  `;
  return transporter.sendMail({
    from: `"${APP_NAME}" <${FROM_EMAIL}>`,
    to: email,
    subject: `Verify your ${APP_NAME} account`,
    html,
  });
};

const sendPasswordResetEmail = async (email, username, token) => {
  const link = `${APP_URL}/reset-password?token=${token}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${cardStyles}">
        <h1 style="color:#111;font-size:24px;margin:0 0 8px">Reset Your Password</h1>
        <p style="color:#555;font-size:15px;line-height:1.6">Hi ${username}, we received a request to reset your ${APP_NAME} password.</p>
        <a href="${link}" style="${btnStyles}">Reset Password</a>
        <p style="color:#888;font-size:13px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#aaa;font-size:12px">${APP_NAME} · The Creator Growth Platform</p>
      </div>
    </div>
  `;
  return transporter.sendMail({
    from: `"${APP_NAME}" <${FROM_EMAIL}>`,
    to: email,
    subject: `Reset your ${APP_NAME} password`,
    html,
  });
};

const sendTicketApprovalEmail = async (email, username, credits) => {
  const html = `
    <div style="${emailStyles}">
      <div style="${cardStyles}">
        <h1 style="color:#111;font-size:24px;margin:0 0 8px">🎉 Proof Approved!</h1>
        <p style="color:#555;font-size:15px;line-height:1.6">Hi ${username}, your watch proof was approved. <strong>${credits} credits</strong> have been added to your account!</p>
        <a href="${APP_URL}/dashboard" style="${btnStyles}">View Dashboard</a>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#aaa;font-size:12px">${APP_NAME} · The Creator Growth Platform</p>
      </div>
    </div>
  `;
  return transporter.sendMail({
    from: `"${APP_NAME}" <${FROM_EMAIL}>`,
    to: email,
    subject: `Your proof was approved — ${credits} credits added!`,
    html,
  });
};

const sendWelcomePremiumEmail = async (email, username, package_name) => {
  const html = `
    <div style="${emailStyles}">
      <div style="${cardStyles}">
        <h1 style="color:#111;font-size:24px;margin:0 0 8px">⭐ Welcome to Premium!</h1>
        <p style="color:#555;font-size:15px;line-height:1.6">Hi ${username}, thank you for your purchase! Your <strong>${package_name}</strong> credits have been added to your account. Enjoy priority promotion and more!</p>
        <a href="${APP_URL}/dashboard" style="${btnStyles}">Start Growing</a>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#aaa;font-size:12px">${APP_NAME} · The Creator Growth Platform</p>
      </div>
    </div>
  `;
  return transporter.sendMail({
    from: `"${APP_NAME}" <${FROM_EMAIL}>`,
    to: email,
    subject: `Premium activated — your credits are ready!`,
    html,
  });
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTicketApprovalEmail,
  sendWelcomePremiumEmail,
};
