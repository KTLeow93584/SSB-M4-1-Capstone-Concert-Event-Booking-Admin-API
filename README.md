## Republic of Rock (Event Management & Hosting - Concert) Mock App, Back-end Server

## Code style
Express.js v4.19.2/Javascript ES

[![React](https://img.shields.io/badge/Coding%20Style-React-brightgreen.svg?style=flat)](https://github.com/facebook/react)
[![ES-JS](https://img.shields.io/badge/Coding%20Style-Javascript%20ES%202022-brightgreen.svg?style=flat)](https://github.com/standard/standard)

## Pre-requisites
Navigating through this project requires you to at least have a fundamental level of understanding of the following:

1. [CSS/Tailwind Framework](https://tailwindcss.com/)
2. [PostgreSQL](https://www.postgresql.org/)
3. [Embedded JavaScript Templates - Used in Mail Templates](https://ejs.co/)
4. [Google Firebase Setup - Social Platform Authentication](https://console.firebase.google.com/u/0/)
5. [REST APIs](https://www.geeksforgeeks.org/rest-api-introduction/) and hosting (IP Addresses, ports, etc.).
6. [How environment variables/secrets work](https://vitejs.dev/guide/env-and-mode)
7. [JSON Web Tokens](https://jwt.io/introduction)
8. [Mailgun Integration](https://www.mailgun.com/)
9. [Telesign Integration](https://www.telesign.com/)

## Features
1. **Authentication** (Admins/Staff Only - WIP)
Registration and Login via Email/Password, Google, Facebook.

2. **Mobile Phone Number** Verification (Integration-side)
SMS OTP before registration form is submitted to back-end to verify phone validity. Most of the inner workings are from the back-end server. Using Telesign third party service, free account has a limited amount of verifications before the free credits expire. Once expired, back-end server will only ensure that no duplicate numbers will be permitted and SMS code prompts will be disabled from then on.

3. **CRUD Functionalities** (Create, Read, Update, Delete)
Schedule, manage and coordinate event bookings with the team! The front-end side mainly deals with consumers, in this case, the prospective clients (Music Company Agents, Band Agents, etc.) desiring to make their future band tour in a certain country a reality.

4. **Records Tracking/CRUD** (WIP)
Admins/Staffs can have a bird's eye view on all the existing event bookings, as well as power to approve/reject and make adjustments to the bookings.

## Installation/Setup
- Clone, fork or download the project as zip.
- Ensure that your system has [NPM](https://nodejs.org/en) installed in your system before proceeding forward.
- Open the project's base folder with your desired IDE. (**VSC/VS2019/etc.**)
- Run the command, `npm i` or `npm install` to install all the required packages specified in <b>package.json</b>.
- Create a `.env` file at the base project directory and ensure the file has the following key/value pairs filled:
```
# Your Preferred SQL Domain.
DATABASE_URL = INSERT_URL_HERE
SECRET_KEY = INSERT_NUMBER_STRING_HERE

# JWToken Life Cycle Duration (Expires "x" seconds from creation) 
ACCESS_TOKEN_EXPIRY = INSERT_SECONDS_HERE
REFRESH_TOKEN_EXPIRY = INSERT_SECONDS_HERE
FORGET_PASSWORD_TOKEN_EXPIRY = INSERT_SECONDS_HERE

# Password Hashing Settings
PASSWORD_HASH_AMOUNT = INSERT_HASH_AMOUNT_HERE (E.g. 12)

# Project Environment (Development, Staging or Production)
PROJECT_ENV = Development

# Client App's IP Address (To redirect them, e.g. from emails)
# E.g.
# Local: http://localhost:INSERT_PORT_NUMBER
# Staging: https://INSERT_DOMAIN_URL.vercel.app/
# Production: https://INSERT_DOMAIN_URL.vercel.app/
CLIENT_URL = INSERT_IP_ADDRESS_HERE

# Firebase Secrets (Grab from Firebase Console)
FIREBASE_SERVICE_ACCOUNT_TYPE = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_PROJECT_ID = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_CLIENT_ID = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_AUTH_URI = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_TOKEN_URI = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_CERT_URL = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_CLIENT_CERT_URL = INSERT_VAR_HERE
FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN = INSERT_VAR_HERE

# Telesign Credentials
TELESIGN_API_KEY = INSERT_VAR_HERE
TELESIGN_CUSTOMER_ID = INSERT_VAR_HERE

# Mailgun Credentials
MAILGUN_API_KEY = INSERT_VAR_HERE
MAILGUN_DOMAIN = INSERT_VAR_HERE
```

## How to deploy?
- [Development] Run the command, `node index.js` to have it work on your local host environment. Start up your browser with the IP address being, for example, `http://localhost:[Your Port Number]`.
- [Staging - Render] Upload your project on GitHub and import directly from there.

## Built-in Dummy Users
- List of Dummy Users usable for Back-End Server's Authentications:

1. Admins
```
admin@admin.com, 123456
```

2. Staffs
```
staff1@staff.com, 111111
staff2@staff.com, 222222
staff3@staff.com, 333333
```

## Current Active Deployment(s)
1. [Render](https://ssb-m4-1-capstone-concert-event-booking.onrender.com/)

## Credits
[Work In Progress]

## Notes/Addendums
- This project was created as a part of with [Sigma School Bootcamp](https://sigmaschool.co/complete-software-development-programme)'s Module (#4) capstone project/final assessment requirements.
- It is linked to a front-end project, in which the latter project can be found [here](https://github.com/KTLeow93584/SSB-M4-1-Capstone-Concert-Event-Booking-App).

## Pending Features
1. Landing & Authentication Pages.
2. Tracking Pages.
3. Unit Tests.
4. Profile-related APIs.

## License
MIT © [Leow Kean Tat/Project Kazcade](https://github.com/KTLeow93584)
