# WayStayy Webapp

WayStayy is a hotel booking web application inspired by OYO and Airbnb. It supports three user roles: admins, hotel owners, and customers. Customers can search hotels, choose hourly or full-day slots, reserve rooms, pay through Razorpay, and review completed stays. Hotel owners can create hotel listings, upload images, define rooms, and manage hotel details. Admins can approve or reject hotel listings and manage platform users.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- NextAuth v5 credentials auth
- Razorpay payments
- Resend transactional email
- Cloudinary image uploads
- Zod validation
- React Hook Form

## Core Features

- Role-based accounts: `ADMIN`, `OWNER`, `CUSTOMER`
- User registration and login
- Admin-only routes for user and hotel approval workflows
- Owner dashboard for creating hotel listings
- Hotel image upload through Cloudinary
- Hotel search by city/location query
- Room availability by slot:
  - 3 hours
  - 6 hours
  - 12 hours
  - Full day
- Multi-day full-day booking with start date and end date
- Razorpay order creation and payment verification
- Booking confirmation, cancellation, hotel status, welcome, and review-nudge emails
- Customer booking dashboard
- Booking cancellation and refund status update flow
- Customer reviews with media support
- Restaurant and menu item data model/API support

## Architecture

```text
Browser
  |
  | Next.js pages and React components
  v
App Router
  |
  | Server components, client components, middleware/proxy auth checks
  v
API Routes
  |
  | auth, hotels, rooms, bookings, payments, reviews, restaurants, upload
  v
Domain Services
  |
  | Prisma, Razorpay, Resend, Cloudinary, rate limiting
  v
PostgreSQL + External Providers
```

### Main Directories

```text
src/app
  Route groups, pages, layouts, and API route handlers.

src/components
  Shared UI components, hotel search/listing widgets, slot picker, header, providers.

src/lib
  Auth, database client, payments, email, Cloudinary, rate limiting, slot generation helpers.

src/types
  Shared TypeScript types and NextAuth module augmentation.

prisma
  Prisma schema and seed script.

scripts
  Utility scripts for demo users, hotels, rooms, and debugging.
```

## Role Model

### Admin

- Accesses `/admin`.
- Can view platform users.
- Can approve or reject hotel listings through admin hotel approval APIs.
- Intended to onboard/deboard hotels and manage platform content.

### Hotel Owner

- Accesses `/owner`.
- Can create hotel profiles.
- Can add hotel details, amenities, location, policies, rooms, and images.
- Owns hotel records through `ownerId`.

### Customer

- Accesses `/dashboard`.
- Can search hotels.
- Can reserve available slots.
- Can pay for bookings.
- Can cancel eligible bookings.
- Can review completed stays.

## Data Model

The main Prisma models are:

- `User`: login identity and role.
- `Hotel`: owner-managed property listing.
- `HotelImage`: uploaded hotel images.
- `Room`: bookable room inventory.
- `RoomSlot`: dated availability slots for hourly and full-day booking.
- `Booking`: customer reservation tied to a room slot and payment.
- `Payment`: Razorpay payment state.
- `BookingExtension`: future extension support for adding hours.
- `Review` and `ReviewMedia`: customer review content and uploaded media.
- `Restaurant` and `MenuItem`: hotel restaurant menu support.
- `AuditLog`: admin/owner activity tracking model.

## Booking Flow

1. Customer searches hotels by city and dates.
2. Customer opens a hotel and selects a room slot.
3. Hourly bookings use a single date and slot.
4. Full-day bookings can use a start date and end date.
5. The booking API validates availability.
6. The API marks the selected slot or full-day date range as booked.
7. Razorpay order is created.
8. Customer completes payment.
9. Payment verification marks the booking as confirmed.
10. Confirmation email is sent.

## Environment Variables

Create `.env.local` for local development. Do not commit real secrets.

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"

NEXTAUTH_URL="http://localhost:3001"
NEXTAUTH_SECRET="replace-with-a-long-random-secret"
AUTH_SECRET="replace-with-a-long-random-secret"

RAZORPAY_KEY_ID="rzp_test_xxxxx"
RAZORPAY_KEY_SECRET="xxxxx"
NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_xxxxx"

RESEND_API_KEY="re_xxxxx"

CLOUDINARY_CLOUD_NAME="xxxxx"
CLOUDINARY_API_KEY="xxxxx"
CLOUDINARY_API_SECRET="xxxxx"
```

## Local Setup

Install dependencies:

```bash
npm install
```

Generate Prisma client and prepare the database:

```bash
npx prisma generate
npx prisma db push
```

Seed demo data when needed:

```bash
npx prisma db seed
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3001
```

## Scripts

```bash
npm run dev
```

Starts the Next.js development server.

```bash
npm run build
```

Creates a production build and runs TypeScript checks.

```bash
npm run start
```

Starts the production server after `npm run build`.

```bash
npm run lint
```

Runs ESLint.

## API Overview

```text
/api/auth/register
/api/auth/[...nextauth]
/api/search
/api/hotels
/api/hotels/[id]
/api/hotels/[id]/rooms
/api/hotels/[id]/restaurant
/api/admin/hotels/[id]/approve
/api/rooms/[roomId]/availability
/api/rooms/[roomId]/slots/generate
/api/bookings
/api/bookings/[id]/cancel
/api/bookings/[id]/complete
/api/payments/verify
/api/reviews
/api/reviews/[id]/reply
/api/restaurants/[restaurantId]/menu-items
/api/restaurants/[restaurantId]/menu-items/[itemId]
/api/upload
```

## Deployment Notes

The app is designed for deployment on a Node-compatible Next.js host such as Vercel.

Before deploying:

- Configure all environment variables in the hosting platform.
- Use a production PostgreSQL database.
- Run Prisma migrations or `prisma db push` as appropriate for the environment.
- Configure Razorpay webhook/payment keys for production.
- Configure Resend sender/domain verification.
- Configure Cloudinary upload credentials.

### Razorpay Setup

Create API keys in the Razorpay Dashboard and configure these variables locally and in the hosting platform:

```env
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="..."
NEXT_PUBLIC_RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_WEBHOOK_SECRET="..."
```

`RAZORPAY_KEY_ID` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` must contain the same key ID. Never expose `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` through a `NEXT_PUBLIC_` variable.

Create a Razorpay webhook pointing to:

```text
https://YOUR_DOMAIN/api/payments/webhook
```

Subscribe it to `payment.captured`, `payment.failed`, and `order.paid`, and use the same webhook secret in the dashboard and `RAZORPAY_WEBHOOK_SECRET`. Test mode keys begin with `rzp_test_`; live keys begin with `rzp_live_`.

### Google Sign-In Setup

Create an OAuth 2.0 Web application in Google Cloud Console and configure:

```env
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
```

Add these authorized redirect URIs:

```text
http://localhost:3001/api/auth/callback/google
https://YOUR_DOMAIN/api/auth/callback/google
```

The Google button appears only when both environment variables are configured. New Google users are created as customers. Existing users with the same verified Google email are linked to their current WayStayy role and profile.

## Current Implementation Notes

- Multi-day booking is implemented for full-day slots.
- Hourly bookings remain single-date reservations.
- `BookingExtension` exists in the data model, but a full extension UI/API workflow still needs to be completed.
- Restaurant menu models and API routes exist; owner-facing menu management UI can be expanded further.
- The Next.js build currently warns that the `middleware` file convention is deprecated in favor of `proxy`; the app still builds successfully.

## Quality Checks

Use these before pushing changes:

```bash
npm run lint
npm run build
```
