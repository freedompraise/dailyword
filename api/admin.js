// api/admin.js - Admin router for admin functions (broadcast, etc.)
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../supabaseClient');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // Password from env vars
const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN) : null;

// HTML form for interactive message sending
const getFormHTML = (error = null, success = null) => `
<!DOCTYPE html>
<html>
<head>
  <title>Admin Broadcast - DailyWord Bot</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-top: 0;
    }
    label {
      display: block;
      margin: 15px 0 5px;
      font-weight: 500;
      color: #555;
    }
    input[type="password"], textarea {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
    }
    textarea {
      min-height: 120px;
      font-family: inherit;
      resize: vertical;
    }
    button {
      background: #007bff;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 4px;
      font-size: 16px;
      cursor: pointer;
      margin-top: 15px;
    }
    button:hover {
      background: #0056b3;
    }
    .error {
      background: #fee;
      color: #c33;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    .success {
      background: #efe;
      color: #3c3;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    .info {
      background: #e7f3ff;
      color: #0066cc;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📢 Admin Broadcast</h1>
    ${error ? `<div class="error">❌ ${error}</div>` : ''}
    ${success ? `<div class="success">✅ ${success}</div>` : ''}
    <div class="info">
      💡 Enter your password and message below. The message will be sent to all active users.
    </div>
    <form method="POST">
      <label for="password">Password:</label>
      <input type="password" id="password" name="password" required autocomplete="off">
      
      <label for="message">Message to send:</label>
      <textarea id="message" name="message" placeholder="Type your message here..." required></textarea>
      
      <button type="submit">🚀 Send Broadcast</button>
    </form>
  </div>
</body>
</html>
`;

module.exports = async (req, res) => {
  if (!bot) {
    return res.status(500).send(getFormHTML('Bot not configured. Please set TELEGRAM_TOKEN.'));
  }
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).send(getFormHTML('Admin password not configured. Please set ADMIN_PASSWORD.'));
  }
  
  // GET request: Show form
  if (req.method === 'GET') {
    return res.status(200).send(getFormHTML());
  }
  
  // POST request: Process broadcast
  if (req.method === 'POST') {
    const { password, message } = req.body;
    
    // Verify password
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).send(getFormHTML('Invalid password. Please try again.'));
    }
    
    if (!message || !message.trim()) {
      return res.status(400).send(getFormHTML('Message is required.'));
    }
    
    try {
      // Get all active users
      const { data: users, error: fetchError } = await supabase
        .from('users')
        .select('id, chat_id');
      
      if (fetchError) {
        console.error('Error fetching users:', fetchError);
        return res.status(500).send(getFormHTML('Failed to fetch users from database.'));
      }
      
      if (!users || users.length === 0) {
        return res.status(200).send(getFormHTML(null, 'No users found in database.'));
      }
      
      let successCount = 0;
      let failureCount = 0;
      const failures = [];
      
      // Send message to all users
      for (const user of users) {
        try {
          await bot.sendMessage(user.chat_id, message.trim(), { parse_mode: 'HTML' });
          successCount++;
          
          // Rate limiting: small delay between messages to avoid Telegram limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          failureCount++;
          failures.push({ userId: user.id, error: error.message });
          console.error(`Failed to send to user ${user.id}:`, error);
        }
      }
      
      const resultMessage = `Broadcast complete! Sent to ${successCount} user${successCount !== 1 ? 's' : ''}.` +
        (failureCount > 0 ? ` ${failureCount} failed.` : '');
      
      return res.status(200).send(getFormHTML(null, resultMessage));
    } catch (error) {
      console.error('Broadcast error:', error);
      return res.status(500).send(getFormHTML(`Error: ${error.message}`));
    }
  }
  
  // Method not allowed
  return res.status(405).send(getFormHTML('Method not allowed.'));
};

