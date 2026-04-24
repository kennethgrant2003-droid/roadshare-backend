# Create .env file
@"
PORT=3000
NODE_ENV=development

STRIPE_SECRET_KEY=sk_test_REPLACE_WITH_YOUR_KEY
STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_WITH_YOUR_KEY
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_WITH_YOURS

BASE_URL=http://localhost:3000
SUCCESS_URL=http://localhost:3000/success
CANCEL_URL=http://localhost:3000/cancel

JWT_SECRET=supersecret_jwt_key_change_me
DATABASE_URL=your_database_connection_string
"@ | Out-File -Encoding utf8 .env

# Install dependencies
npm install

# Start backend
Start-Process powershell -ArgumentList "npm run dev"

# Open browser
Start-Process "http://localhost:3000"

Write-Host "Setup complete"