const { Sequelize } = require('sequelize');

async function check() {
  const sequelize = new Sequelize(
    'postgres',
    'postgres.dusyzrzjthdljbzebgab',
    'Dola2851!2674',
    {
      host: 'aws-1-eu-central-1.pooler.supabase.com',
      port: 5432,
      dialect: 'postgres',
      logging: false,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      }
    }
  );

  try {
    await sequelize.authenticate();
    console.log('Connected to Supabase DB.');
    const tables = ['devices', 'tarifs', 'sessions', 'users', 'passwords', 'payments'];
    for (const table of tables) {
      const [results] = await sequelize.query(`
        SELECT column_name
        FROM information_schema.columns 
        WHERE table_name = '${table}'
          AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);
      const cols = results.map(r => r.column_name);
      console.log(`Table "${table}": ${cols.join(', ')}`);
    }
  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await sequelize.close();
  }
}

check();
