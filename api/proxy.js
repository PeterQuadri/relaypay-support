/**
 * RelayPay Security Proxy — Vercel Serverless Function
 * ==================================================
 */

export default async function handler(req, res) {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. Extract the target path
  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing "path" query parameter.' });
  }

  // 3. Load the Secret from Environment Variables FIRST
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!secret) {
     console.error("WEBHOOK_SECRET is not set in Vercel settings.");
  }

  // 4. Construct the n8n URL with the token injected
  const n8nBaseUrl = "https://cohort2pod3.app.n8n.cloud/webhook";
  const targetUrl = `${n8nBaseUrl}/${path}?token=${encodeURIComponent(secret || '')}`;

  console.log(`[Proxy] Forwarding to n8n: ${path}`);

  try {
    // 5. Forward the request to n8n
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret || ''
      },
      body: req.method !== 'GET' && req.method !== 'OPTIONS' ? JSON.stringify(req.body) : undefined,
    });

    // 6. Handle the response safely (JSON or Text)
    const contentType = response.headers.get("content-type");
    let responseBody;
    
    if (contentType && contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = { message: await response.text() };
    }
    
    return res.status(response.status).json(responseBody);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
