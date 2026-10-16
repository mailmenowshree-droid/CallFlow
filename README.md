# CallFlow

Browser-based call assignment and operations dashboard.

## Stack
- Next.js App Router
- React + TypeScript
- Tailwind CSS
- MongoDB Atlas (planned persistence)
- Vercel deployment

## Current status
This is the initial UI prototype. The dashboard uses sample data only. Authentication, database persistence, transactional round-robin assignment, scheduled reminders, attendance APIs, and WhatsApp integration are not yet implemented.

## Security
Do not commit secrets, real customer records, or production case data. Use environment variables and approved access controls before operational use.

## Local development
```bash
npm install
npm run dev
```
