import dotenv from "dotenv";

// Load environment variables
const result = dotenv.config();

console.log("🔍 Environment Variables Test\n");

if (result.error) {
  console.log("❌ Error loading .env file:", result.error);
} else {
  console.log("✅ .env file loaded successfully");
}

console.log("\n📋 Checking required variables:");

const requiredVars = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const optionalVars = ["JWT_SECRET", "JWT_EXPIRES_IN", "PORT", "NODE_ENV"];

// Check required variables
requiredVars.forEach((varName) => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: EXISTS (${value.substring(0, 20)}...)`);
  } else {
    console.log(`❌ ${varName}: MISSING`);
  }
});

console.log("\n📋 Optional variables:");

// Check optional variables
optionalVars.forEach((varName) => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: ${value}`);
  } else {
    console.log(`⚪ ${varName}: Not set (will use default)`);
  }
});

console.log("\n💡 Make sure your .env file contains:");
console.log(`
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=your-secret-key-for-jwt-tokens
JWT_EXPIRES_IN=7d
PORT=3003
NODE_ENV=development
`);

// Run test if this file is executed directly
if (require.main === module) {
  // Test complete
}
