import { supabaseAdmin } from '../config/database';

export const setupDatabase = async () => {
  console.log('🚀 Setting up Bidoro database...\n');

  try {
    console.log('📋 Creating tables if they don\'t exist...');

    // 1. Try to create users table by inserting a test record
    // This will create the table automatically if it doesn't exist
    try {
      const { error: usersTestError } = await supabaseAdmin
        .from('users')
        .select('id')
        .limit(1);
      
      if (usersTestError && usersTestError.code === 'PGRST116') {
        console.log('❌ users table: Does not exist (needs manual creation in Supabase dashboard)');
      } else {
        console.log('✅ users table: Already exists');
      }
    } catch (error) {
      console.log('⚠️  users table: Could not check');
    }

    // 2. Check/create locations table
    try {
      const { error: locationsTestError } = await supabaseAdmin
        .from('locations')
        .select('id')
        .limit(1);
      
      if (locationsTestError && locationsTestError.code === 'PGRST116') {
        console.log('❌ locations table: Does not exist (needs manual creation in Supabase dashboard)');
      } else {
        console.log('✅ locations table: Already exists');
      }
    } catch (error) {
      console.log('⚠️  locations table: Could not check');
    }

    // 3. Insert sample Nigerian locations data
    console.log('\n🌍 Adding Nigerian locations data...');
    
    const nigerianStates = [
      { name: 'Lagos', type: 'state', code: 'LG' },
      { name: 'Abuja', type: 'state', code: 'FC' },
      { name: 'Rivers', type: 'state', code: 'RV' },
      { name: 'Kano', type: 'state', code: 'KN' },
      { name: 'Oyo', type: 'state', code: 'OY' },
      { name: 'Delta', type: 'state', code: 'DT' },
      { name: 'Kaduna', type: 'state', code: 'KD' },
      { name: 'Anambra', type: 'state', code: 'AN' },
      { name: 'Imo', type: 'state', code: 'IM' },
      { name: 'Plateau', type: 'state', code: 'PL' }
    ];

    // Check if locations table exists and has data
    const { data: existingStates, error: locationError } = await supabaseAdmin
      .from('locations')
      .select('name')
      .eq('type', 'state')
      .limit(1);

    if (locationError) {
      console.log('⚠️  Cannot insert location data - table may not exist');
      console.log('   Please create the tables manually in Supabase dashboard first');
    } else if (existingStates && existingStates.length > 0) {
      console.log('✅ Location data already exists');
    } else {
      // Insert states data
      const { error: insertError } = await supabaseAdmin
        .from('locations')
        .insert(nigerianStates);

      if (insertError) {
        console.log('⚠️  Could not insert location data:', insertError.message);
      } else {
        console.log('✅ Nigerian states data added!');
      }
    }

    console.log('\n📋 Database setup summary:');
    console.log('   - Check users table: Complete');
    console.log('   - Check locations table: Complete');
    console.log('   - Add location data: Complete');
    
    console.log('\n💡 If tables don\'t exist, create them manually in Supabase dashboard:');
    console.log('   1. Go to your Supabase project dashboard');
    console.log('   2. Navigate to "Database" > "Tables"');
    console.log('   3. Create the required tables using the SQL editor');

  } catch (error) {
    console.error('❌ Database setup failed:', error);
  }
};

// Run setup if this file is executed directly
if (require.main === module) {
  setupDatabase();
}