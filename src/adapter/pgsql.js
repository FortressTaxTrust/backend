import pgPromise from 'pg-promise';
import monitor from 'pg-monitor';

const initOptions = {
  error(err, e) {
    if (e.cn) console.error('Connection Info:', e.cn);
  },
  query(e) {
    // console.log('QUERY:', e.query);
  }
};

const pgp = pgPromise(initOptions);

monitor.attach(initOptions);
monitor.setTheme('matrix'); 

const dbConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'mydb',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  ssl: { rejectUnauthorized: false }
};

const db = pgp(dbConfig);

// Test connection
try {
    await db.one('SELECT 1');
} 	catch (err) {
  console.error('DB not reachable:', err.message);
}

export { pgp };
export default db
