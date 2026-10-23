# assign4

A web app built with Next.js and deployed on the free tier of Vercel.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (HTML, CSS)
- **Auth:** [Clerk](https://clerk.com/)
- **Database:** [Supabase](https://supabase.com/)
- **External API:** _TBD_
- **Hosting:** [Vercel](https://vercel.com/) (free tier)

## Getting Started

> The Next.js app has not been scaffolded yet. These steps will be filled in as the project takes shape.

1. Clone the repo:
   ```bash
   git clone https://github.com/r3dw/assign4.git
   cd assign4
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in the values below.
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Environment Variables

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

Never commit real secrets. `.env*` files are gitignored except `.env.example`.

## Deployment

Pushing to `main` deploys to Vercel once the repo is connected. Add the environment variables above in the Vercel project settings.

## Roadmap

- [ ] Scaffold Next.js app
- [ ] Add Clerk authentication
- [ ] Set up Supabase database
- [ ] Integrate external API
- [ ] Deploy to Vercel
