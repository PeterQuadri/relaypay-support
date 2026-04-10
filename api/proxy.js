/**
 * RelayPay Security Proxy — Vercel Serverless Function
 * ==================================================
 * This function acts as a "Gatekeeper" to prevent the n8n WEBHOOK_SECRET 
 * from being exposed to the public browser.
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

  // 2. Extract the target webhook path from query params (e.g., /api/proxy?path=relaypay-analytics)
  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing "path" query parameter.' });
  }

  // 3. Construct the n8n URL
  // We assume all your webhooks are on the same n8n instance.
  const n8nBaseUrl = "https://cohort2pod3.app.n8n.cloud/webhook";
  const targetUrl = `${n8nBaseUrl}/${path}`;

  // 4. Inject the private Secret from Vercel Environment Variables
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!secret) {
     console.error("WEBHOOK_SECRET is not set in Vercel Environment Variables.");
     // We continue, but n8n will likely reject the request with 401.
  }

  try {
    // 5. Forward the request to n8n
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret || '' // Changed from x-webhook-token to match n8n
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();
    
    // 6. Return n8n's response to the browser
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
