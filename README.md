# Express Backend

A Node.js Express backend using ES modules with environment variables, API calls, and JWT authentication.

## Features

- Express.js server with ES modules
- Environment variables with dotenv
- Health check endpoint
- JWT authentication middleware
- Axios for API calls

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables:
```
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key-here
```

3. Start the server:
- Development mode: `npm run dev`
- Production mode: `npm start`

## API Endpoints

### Health Check
- `GET /health`
  - Returns server status, timestamp, and uptime

## Project Structure

```
src/
├── config/         # Configuration files
├── middleware/     # Custom middleware
├── routes/         # Route handlers
└── index.js        # Main application file
``` 