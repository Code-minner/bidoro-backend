#!/bin/bash

echo "íº€ Setting up Bidoro Backend structure..."

# Create main directories
mkdir -p src/{config,controllers,middleware,models,routes,services,types,utils}
mkdir -p logs

# Create config files
cat > src/config/supabase.ts << 'EOF'
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
EOF

# [Copy the rest of the script from the artifact above]
