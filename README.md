# Demo - Live Preview (Next.js)

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Initial Setup

1. Run `nvm use` to ensure you are on the correct version of node.
2. Run `npm install` to install all dependencies.
3. Copy `.env.local.example` and rename to `.env.local`.
4. Populate the `.env.local` file with values for your `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENV_ID`, `CONTENTFUL_DELIVERY_KEY`, `CONTENTFUL_PREVIEW_KEY`.
5. Note that `CONTENTFUL_PREVIEW_SECRET` and `CONTENTFUL_REVALIDATION_SECRET` are keys that you will need to invent, and should ideally be different.
6. Configure a Content Preview within Contentful with the following URL: `http://localhost:3000/api/draft?secret=[ADD CONTENTFUL_PREVIEW_SECRET HERE]&type=page&slug={entry.fields.slug}`
7. Create a custom Webhook in Contentful that fires on Entry `Create`, `Archive`, `Unarchive`, `Publish`, `Unpublish`, and `Delete`, pointing to the revalidation endpoint with your secret key added: `/api/revalidate?secret=[ADD CONTENTFUL_REVALIDATE_SECRET HERE]`. NOTE: If running this locally, Contentful cannot post a Webhook to `localhost`, so you will need to use ngrok to publicly serve the endpoint (e.g. `ngrok http --url=kit-singular-subtly.ngrok-free.app 3000`).
8. Assuming you have already installed the [Contentful CLI](https://www.contentful.com/developers/docs/tutorials/cli/installation/), import the baseline content model via the following command: `contentful space import --space-id <YOUR SPACE ID> --environment-id [YOUR ENVIRONMENT ID] --content-file content-model.json`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Architecture Decisions

For the rationale behind significant architectural choices in this project, see [`docs/adr/`](./docs/adr).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
