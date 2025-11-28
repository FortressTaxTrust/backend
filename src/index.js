import app from './app.js';
import { startScheduler } from './scheduler/cron.js';

const port = process.env.PORT || 8080;

// Start server
app.listen(port, () => {
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
  }
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`🏥 Health check available at: http://localhost:${port}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
 