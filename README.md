<div align="center">

# GitGraph Worker

**Asynchronous worker responsible for PDF report generation in the GitGraph ecosystem.**

![Build Status](https://img.shields.io/badge/build-passing-00C49F)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-ISC-green)
![Status](https://img.shields.io/badge/status-live-success)

</div>

---

# ⚓ Overview

**GitGraph Worker** is the asynchronous processing service behind [GitGraph](https://github.com/Gustaavo-404/gitgraph)'s PDF report generation.

When a user requests a PDF report on the main platform, the request is published to a **RabbitMQ** queue instead of being processed synchronously. This worker consumes that queue independently, renders the report using a headless browser, uploads the result to cloud storage, and updates the database — without ever blocking the GitGraph frontend or hitting serverless timeout limits.

It's designed to run as a **long-lived, persistent process** rather than a short-lived serverless function, which is what makes it well suited for headless-browser workloads that can take longer than typical serverless timeouts allow.

---

# ⚓ Tech Stack

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ_(amqplib)-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer_Core-40B5A4?style=for-the-badge)
![Chromium](https://img.shields.io/badge/@sparticuz/chromium-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![AWS S3](https://img.shields.io/badge/AWS_S3-569A31?style=for-the-badge&logo=amazons3&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)

- **amqplib** — connects to and consumes jobs from the RabbitMQ (CloudAMQP) queue shared with the main GitGraph platform.
- **puppeteer-core + @sparticuz/chromium** — renders the PDF report using a lightweight, pre-optimized Chromium build suited for cloud environments, without bundling a full local Chromium install.
- **@prisma/client / Prisma** — reads repository/report data and updates report status directly against the same PostgreSQL (Neon) database used by GitGraph.
- **@aws-sdk/client-s3** — uploads the generated PDF to Amazon S3 once rendering is complete.

---

# ⚓ Architecture

```
RabbitMQ Queue (CloudAMQP)
        │
        ▼
GitGraph Worker (Node.js, persistent — Render)
        │
        ├── Consume job (amqplib)
        ├── Fetch report data (Prisma → Neon PostgreSQL)
        ├── Render PDF (puppeteer-core + @sparticuz/chromium, headless)
        ├── Upload to Amazon S3 (@aws-sdk/client-s3)
        └── Update report status/URL in database (Prisma)
```

The worker runs independently from the main [GitGraph](https://github.com/Gustaavo-404/gitgraph) Next.js application and communicates with it exclusively through the shared RabbitMQ queue and PostgreSQL database — there's no direct HTTP coupling between the two services.

---

# 📦 Installation

Clone the repository:

```
git clone https://github.com/Gustaavo-404/gitgraph-worker.git
cd gitgraph-worker
```

Install dependencies:

```
npm install
```

> This worker consumes jobs published by the main [**GitGraph**](https://github.com/Gustaavo-404/gitgraph) platform. Both services must point to the same `QUEUE_URL` and `DATABASE_URL` to work together correctly.

---

# ⚙️ Environment Variables

Create a `.env` file in the root directory:

```dotenv
# Database (shared with the main GitGraph platform)
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"

# RabbitMQ (shared with the main GitGraph platform)
QUEUE_URL="amqps://user:password@instance.rmq.cloudamqp.com/vhost"

# AWS S3
AWS_ACCESS_KEY_ID="your_aws_access_key_id"
AWS_SECRET_ACCESS_KEY="your_aws_secret_access_key"
AWS_REGION="your_aws_region"
AWS_S3_BUCKET_NAME="your_s3_bucket_name"
```

---

# 🗄 Database Setup (Prisma)

Generate the Prisma client:

```
npm run prisma:generate
```

The worker uses the same schema and database as the main GitGraph platform, so migrations are managed from the [**gitgraph**](https://github.com/Gustaavo-404/gitgraph) repository — this service only needs the generated client to read/write data.

---

# ▶️ Running the Worker

Start the worker:

```
npm start
```

Once running, it connects to the RabbitMQ queue and stays alive, consuming PDF generation jobs as they arrive. There's no HTTP server or port to open — it's a background consumer process.

For local development against the full GitGraph flow, make sure the main [**gitgraph**](https://github.com/Gustaavo-404/gitgraph) app is also running and pointed at the same `QUEUE_URL` and `DATABASE_URL`.

---

# 📊 Key Responsibilities

- **Queue Consumption** – listens to the RabbitMQ (CloudAMQP) queue for incoming PDF generation jobs.
- **Headless PDF Rendering** – uses `puppeteer-core` with `@sparticuz/chromium` to render repository reports as PDFs in a cloud-optimized headless environment.
- **Cloud Storage** – uploads generated PDFs to Amazon S3 via the AWS SDK.
- **Database Sync** – updates report status and file location in PostgreSQL via Prisma, so the main platform can reflect completion in real time.
- **Persistent, Long-Running Process** – deployed on Render as a continuously running service, avoiding the timeout and cold-start constraints of serverless functions for this kind of workload.

---

# 🎯 Why a Separate Worker?

PDF generation with a headless browser is inherently heavier and slower than typical API requests. Running it inline in the main GitGraph application would risk request timeouts and degrade the user experience. By decoupling this work through a message queue and a dedicated, persistent worker:

- The GitGraph frontend stays fast and responsive, even while a report is being generated.
- The worker can scale, restart, or fail independently without affecting the main platform.
- Long-running headless-browser sessions run in an environment designed for them, instead of fighting serverless time limits.

---

# 📄 License

GitGraph Worker is licensed under the ISC License.

---

⚓ GitGraph Worker — Turning queued jobs into finished reports.
