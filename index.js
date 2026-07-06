import 'dotenv/config'; // Loads environmental variables locally
import amqp from 'amqplib';
import http from 'http';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Initialize global instances for connection reuse
const prisma = new PrismaClient();

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// HTML Template compiler for PDF generation
function generatePdfHtml({ report, projectId, generatedAt, logoUrl }) {
    const renderLanguageBars = () => {
        return Object.entries(report.languages)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([lang, percentage]) => `
        <div class="language-bar">
          <span class="language-name">${lang}</span>
          <div class="bar-container"><div class="bar-fill" style="width: ${percentage}%"></div></div>
          <span class="language-percent">${percentage.toFixed(1)}%</span>
        </div>
      `).join('');
    };

    const renderInsights = () => report.health.insights.map(insight => `<li>${insight}</li>`).join('');

    const renderHealthFactors = () => {
        return Object.entries(report.health.factors).map(([key, value]) => {
            const label = key.replace(/([A-Z])/g, ' $1').trim();
            return `
        <div class="factor-item">
          <div class="factor-value">${Math.round(value * 100)}%</div>
          <div class="factor-label">${label}</div>
        </div>
      `;
        }).join('');
    };

    const avgCommitsPerContributor = report.contributors > 0 ? Math.round(report.commits.commits90d / report.contributors) : 0;
    const totalIssues = report.openIssues + report.closedIssues;
    const issueClosureRate = totalIssues > 0 ? Math.round((report.closedIssues / totalIssues) * 100) : 0;
    const last10Commits = report.commits.daily.slice(-10).reverse();

    return `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="utf-8">
    <title>GitGraph Report - ${projectId}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #e5e5e5; line-height: 1.3; font-size: 8.5px; padding: 24px; }
        .mt-32 { margin-top: 32px; }
        .report { max-width: 100%; margin: 0; background: #0a0a0a; padding: 8px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #57e071; }
        .logo-area { display: flex; align-items: center; gap: 8px; }
        .logo-img { height: 20px; width: auto; object-fit: contain; background: transparent; }
        .logo-placeholder { width: 30px; height: 30px; background: #57e071; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: black; font-weight: bold; font-size: 16px; }
        .title h1 { font-size: 16px; font-weight: 700; color: white; margin-bottom: 2px; }
        .title p { font-size: 8px; color: #a0a0a0; }
        .meta { text-align: right; }
        .meta .project-id { font-family: monospace; color: #57e071; font-size: 10px; font-weight: 600; }
        .meta .date { color: #a0a0a0; font-size: 7px; margin-top: 3px; }
        .section { margin-bottom: 32px; }
        .section-title { font-size: 12px; font-weight: 600; color: #57e071; margin-bottom: 6px; padding-bottom: 2px; border-bottom: 1px solid #333; text-transform: uppercase; letter-spacing: 0.3px; }
        .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
        .card { background: #111; border: 1px solid #222; border-radius: 5px; padding: 8px; }
        .metric-card .label { font-size: 7px; text-transform: uppercase; color: #888; letter-spacing: 0.2px; margin-bottom: 3px; }
        .metric-card .value { font-size: 18px; font-weight: 700; color: white; }
        .metric-card .icon { color: #57e071; font-size: 12px; margin-bottom: 4px; }
        .health-score-container { display: flex; align-items: center; gap: 12px; }
        .score-ring { width: 60px; height: 60px; position: relative; }
        .score-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
        .score-ring circle { fill: none; stroke-width: 7; }
        .score-ring .bg { stroke: #222; }
        .score-ring .progress { stroke: #57e071; stroke-linecap: round; }
        .score-number { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 18px; font-weight: 700; color: white; }
        .health-details { flex: 1; }
        .grade-badge { display: inline-block; background: #57e071; color: black; font-weight: 700; padding: 2px 5px; border-radius: 10px; font-size: 10px; margin-bottom: 3px; }
        .insights-list { list-style: none; margin-top: 4px; }
        .insights-list li { font-size: 7px; color: #ccc; margin-bottom: 2px; padding-left: 8px; position: relative; }
        .insights-list li::before { content: "•"; color: #57e071; position: absolute; left: 0; }
        .factor-item { text-align: center; padding: 4px 1px; background: #1a1a1a; border-radius: 4px; }
        .factor-value { font-size: 12px; font-weight: 700; color: #57e071; margin-bottom: 2px; }
        .factor-label { font-size: 6px; text-transform: uppercase; color: #888; }
        .table-responsive { max-height: 140px; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 7px; }
        th { background: #1a1a1a; color: #57e071; font-weight: 600; text-transform: uppercase; padding: 4px 3px; text-align: left; border-bottom: 1px solid #333; }
        td { padding: 3px; border-bottom: 1px solid #222; color: #ccc; }
        .language-bar { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
        .language-name { width: 55px; font-size: 7px; font-weight: 500; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar-container { flex: 1; height: 4px; background: #222; border-radius: 2px; overflow: hidden; }
        .bar-fill { height: 100%; background: #57e071; border-radius: 2px; }
        .language-percent { width: 32px; font-size: 7px; color: #57e071; font-weight: 600; text-align: right; }
        .footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #222; text-align: center; font-size: 6px; color: #555; }
    </style>
    </head>
    <body>
    <div class="report">
        <div class="header">
        <div class="logo-area">
            ${logoUrl ? `<img src="${logoUrl}" alt="GitGraph Logo" class="logo-img" />` : `<div class="logo-placeholder">G</div>`}
            <div class="title">
            <h1>GitGraph Repository Report</h1>
            <p>Detailed analytics and health overview</p>
            </div>
        </div>
        <div class="meta">
            <div class="project-id">${projectId}</div>
            <div class="date">Generated: ${generatedAt}</div>
        </div>
        </div>

        <div class="section mt-32">
        <h2 class="section-title">Key Metrics</h2>
        <div class="grid-4">
            <div class="card metric-card"><div class="icon">⭐</div><div class="label">Stars</div><div class="value">${report.stars.toLocaleString()}</div></div>
            <div class="card metric-card"><div class="icon">🔀</div><div class="label">Forks</div><div class="value">${report.forks.toLocaleString()}</div></div>
            <div class="card metric-card"><div class="icon">⚠️</div><div class="label">Open Issues</div><div class="value">${report.openIssues.toLocaleString()}</div></div>
            <div class="card metric-card"><div class="icon">👥</div><div class="label">Contributors</div><div class="value">${report.contributors.toLocaleString()}</div></div>
        </div>
        </div>

        <div class="section">
        <h2 class="section-title">Health Overview</h2>
        <div class="grid-2">
            <div class="card health-score-container">
            <div class="score-ring">
                <svg viewBox="0 0 100 100">
                <circle class="bg" cx="50" cy="50" r="42" />
                <circle class="progress" cx="50" cy="50" r="42" stroke-dasharray="263.89" stroke-dashoffset="${263.89 - (263.89 * report.health.score / 100)}" />
                </svg>
                <div class="score-number">${report.health.score}</div>
            </div>
            <div class="health-details">
                <span class="grade-badge">Grade ${report.health.grade}</span>
                <div style="font-size: 8px; color: #aaa;">Overall health score</div>
            </div>
            </div>
            <div class="card">
            <h3 style="font-size: 10px; margin-bottom: 4px; color: #57e071;">Key Insights</h3>
            <ul class="insights-list">${renderInsights()}</ul>
            </div>
        </div>
        </div>

        <div class="section">
        <h2 class="section-title">Health Factors</h2>
        <div class="grid-5">${renderHealthFactors()}</div>
        </div>

        <div class="section">
        <h2 class="section-title">Commit Activity Summary</h2>
        <div class="grid-2" style="margin-bottom: 8px;">
            <div class="card">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Last 7 days</span><span style="color: #57e071; font-weight: 700;">${report.commits.commits7d}</span></div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Last 30 days</span><span style="color: #57e071; font-weight: 700;">${report.commits.commits30d}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Last 90 days</span><span style="color: #57e071; font-weight: 700;">${report.commits.commits90d}</span></div>
            </div>
            <div class="card">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Avg commits/contributor</span><span style="color: #57e071; font-weight: 700;">${avgCommitsPerContributor}</span></div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Issue closure rate</span><span style="color: #57e071; font-weight: 700;">${issueClosureRate}%</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Open PRs</span><span style="color: #57e071; font-weight: 700;">${report.openPRs}</span></div>
            </div>
        </div>

        <div class="grid-2">
            <div class="card" style="padding: 6px;">
            <h3 style="font-size: 9px; margin-bottom: 4px; color: #57e071;">Daily Commits (last 10)</h3>
            <div class="table-responsive">
                <table>
                <thead><tr><th>Date</th><th>Commits</th></tr></thead>
                <tbody>
                    ${last10Commits.map(day => `<tr><td>${day.date}</td><td>${day.count}</td></tr>`).join('')}
                </tbody>
                </table>
            </div>
            </div>
            <div class="card" style="padding: 6px;">
            <h3 style="font-size: 9px; margin-bottom: 4px; color: #57e071;">Language Distribution</h3>
            <div class="languages-container">${renderLanguageBars()}</div>
            </div>
        </div>
        </div>

        <div class="footer">Generated by GitGraph · Confidential</div>
    </div>
    </body>
    </html>`;
}

// RENDER/STANDALONE REPORT GENERATOR WORKER
async function processQueueMessage(payload) {
    const analyticsId = payload.analyticsId;
    const projectId = payload.projectId;

    console.log(`[INFO] Initiating processing for analytics ID: ${analyticsId}`);

    // 1. Fetch raw analytics data from the database
    const analyticsData = await prisma.repositoryAnalytics.findUnique({
        where: { id: analyticsId }
    });

    if (!analyticsData) {
        throw new Error(`Record ${analyticsId} not found in the database.`);
    }

    const report = typeof analyticsData.reportJson === 'string'
        ? JSON.parse(analyticsData.reportJson)
        : analyticsData.reportJson;

    // 2. Assemble timestamps and metadata
    const generatedAt = new Date().toLocaleString('en-US', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'full',
        timeStyle: 'short',
    });

    // 3. Compile HTML layout
    const fullHtml = generatePdfHtml({
        report,
        projectId,
        generatedAt,
        logoUrl: "https://gitgraph.com.br/logo.png"
    });

    // 4. Initialize the browser engine based on environment
    console.log("[INFO] Initializing Puppeteer...");
    let browser = null;

    try {
        const isProduction = process.env.RENDER || process.env.NODE_ENV === 'production';

        if (isProduction) {
            console.log("[INFO] Running in production/Render environment");
            browser = await puppeteer.launch({
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                args: [
                    ...chromium.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                defaultViewport: chromium.defaultViewport,
            });
        } else {
            console.log("[INFO] Running in local development environment");
            // Se estiver no Windows, usa o Edge local; senão tenta usar o Chrome padrão do sistema
            const localEdgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
            browser = await puppeteer.launch({
                executablePath: process.platform === 'win32' ? localEdgePath : undefined,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        await page.setContent(fullHtml, { waitUntil: 'load' });

        // 5. Generate PDF in-memory buffer with zero margins
        console.log("[INFO] Rendering PDF...");
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
            preferCSSPageSize: true,
        });

        // Safely close browser immediately to release resources
        await browser.close();
        browser = null; 
        console.log("[INFO] PDF successfully generated in memory.");

        // Optionally write local file for validation during development stage
        if (!isProduction) {
            try {
                const fs = await import('fs');
                fs.writeFileSync(`report-${analyticsId}.pdf`, pdfBuffer);
                console.log(`[INFO] Local copy saved: report-${analyticsId}.pdf`);
            } catch (fsErr) {
                console.error("[ERROR] Failed to save local file:", fsErr);
            }
        }

        // 6. Upload generated buffer to S3 with force-download attachment header
        console.log(`[INFO] Uploading PDF to S3 bucket [${process.env.AWS_S3_BUCKET_NAME}]...`);
        const fileName = `reports/report-${analyticsId}.pdf`;

        await s3.send(new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: fileName,
            Body: pdfBuffer,
            ContentType: "application/pdf",
            ContentDisposition: `attachment; filename="github-report-${projectId}.pdf"`,
        }));

        // Construct public S3 URL
        const s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
        console.log(`[INFO] S3 upload completed successfully. Generated URL: ${s3Url}`);

        // 7. Mark database entity status as COMPLETED
        await prisma.repositoryAnalytics.update({
            where: { id: analyticsId },
            data: {
                status: 'COMPLETED',
                pdfUrl: s3Url
            },
        });

        console.log(`[INFO] Database status successfully updated to COMPLETED for analytics ID: ${analyticsId}`);

    } catch (error) {
        console.error("[ERROR] Failed to process database record:", error);

        // Close orphaned browser processes if open
        if (browser) {
            try {
                await browser.close();
            } catch (browserErr) {
                console.error("[ERROR] Failed to close browser after failure:", browserErr);
            }
        }

        // Mark database entity status as FAILED
        try {
            await prisma.repositoryAnalytics.update({
                where: { id: analyticsId },
                data: { status: 'FAILED' },
            });
        } catch (dbErr) {
            console.error("[ERROR] Database transaction failed while updating status to FAILED:", dbErr);
        }

        // Re-throw the error so RabbitMQ can handle the nack flow properly
        throw error;
    }
}

// --- RENDER COMPATIBILITY & HEALTH CHECK SERVER ---
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`[INFO] Health check server listening on port ${PORT}`);
});

// --- RABBITMQ CONTINUOUS CONSUMER LISTENER ---
async function startWorker() {
    const QUEUE_NAME = 'gitgraph_pdf_queue'; 
    const queueUrl = process.env.QUEUE_URL;

    if (!queueUrl) {
        console.error("[ERROR] QUEUE_URL environment variable is missing.");
        process.exit(1);
    }

    try {
        console.log("[INFO] Establishing connection to CloudAMQP (RabbitMQ)...");
        const connection = await amqp.connect(queueUrl);

        // Fail-fast architecture: se a conexão cair, mata o processo 
        // e deixa o Render reiniciar o container de forma limpa.
        connection.on("error", (err) => {
            console.error("[ERROR] RabbitMQ connection error:", err);
        });

        connection.on("close", () => {
            console.error("[WARNING] RabbitMQ connection closed. Exiting process...");
            process.exit(1);
        });

        const channel = await connection.createChannel();

        // Assert queue exists
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        
        // Prefetch set to 1 to prevent resource starvation during concurrency
        await channel.prefetch(1);

        console.log(`[INFO] Worker is active and listening for events on queue: [${QUEUE_NAME}]`);

        // Begin active message consumption loop
        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                try {
                    console.log("\n[INFO] New queue message detected.");
                    
                    const payload = JSON.parse(msg.content.toString());

                    // Executa o processamento diretamente passando o JSON mapeado
                    await processQueueMessage(payload);

                    // Acknowledge processed queue message
                    channel.ack(msg);
                    console.log("[INFO] Message processed and acknowledged.");
                    
                } catch (error) {
                    console.error("[ERROR] Failed to process message queue item:", error);
                    // Não reencaminha a mensagem à fila se for um erro crítico do banco/parsing para evitar loop infinito
                    channel.nack(msg, false, false); 
                }
            }
        });

    } catch (error) {
        console.error("[FATAL] Critical error during worker start sequence:", error);
        setTimeout(startWorker, 5000); // Tenta reconectar em 5s se a conexão inicial falhar
    }
}

// Start consumption loop
startWorker();