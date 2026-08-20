import type { IncomingMessage, ServerResponse } from 'node:http';

type RedirectResolution = {
  target_url: string;
  delay_seconds: number;
  link_name: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function unavailable(response: ServerResponse, status: number, message: string) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Link indisponível</title><body style="font-family:Arial,sans-serif;background:#0b0d12;color:#fff;display:grid;min-height:100vh;place-items:center;margin:0"><main style="max-width:420px;padding:32px;text-align:center"><h1>Link indisponível</h1><p style="color:#aeb6c5">${escapeHtml(message)}</p></main></body></html>`);
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const slug = decodeURIComponent(new URL(request.url ?? '/', 'https://redirect.local').pathname.split('/').pop() ?? '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) {
    unavailable(response, 404, 'Este link não existe ou está pausado.');
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    unavailable(response, 500, 'O redirecionador ainda não foi configurado.');
    return;
  }

  try {
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_redirect_link`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!rpcResponse.ok) throw new Error('Não foi possível resolver o link.');
    const [resolved] = await rpcResponse.json() as RedirectResolution[];
    if (!resolved) {
      unavailable(response, 404, 'Este link não existe ou está pausado.');
      return;
    }
    const target = new URL(resolved.target_url);
    if (target.protocol !== 'https:') throw new Error('Destino inválido.');

    // O contador já foi incrementado de forma atômica dentro da RPC.
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (resolved.delay_seconds === 0) {
      response.statusCode = 302;
      response.setHeader('Location', target.toString());
      response.end();
      return;
    }

    const seconds = Math.min(Math.max(Math.trunc(resolved.delay_seconds), 1), 300);
    const targetJson = JSON.stringify(target.toString()).replace(/</g, '\\u003c');
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(resolved.link_name)}</title><body style="font-family:Arial,sans-serif;background:#0b0d12;color:#fff;display:grid;min-height:100vh;place-items:center;margin:0"><main style="width:min(420px,calc(100% - 40px));padding:32px;text-align:center;border:1px solid #2a3140;border-radius:18px;background:#151922"><h1 style="font-size:20px;margin:0">${escapeHtml(resolved.link_name)}</h1><p style="color:#aeb6c5">Redirecionando em</p><strong id="seconds" style="font-size:40px;color:#6284ff">${seconds}s</strong><p><a id="continue" href="${escapeHtml(target.toString())}" style="display:inline-block;margin-top:18px;background:#6284ff;color:#fff;padding:12px 18px;border-radius:9px;text-decoration:none">Continuar agora</a></p></main><script>const target=${targetJson};let remaining=${seconds};const output=document.getElementById('seconds');const timer=setInterval(()=>{remaining-=1;output.textContent=remaining+'s';if(remaining<=0){clearInterval(timer);location.replace(target)}},1000);</script></body></html>`);
  } catch {
    unavailable(response, 500, 'Não foi possível abrir este link agora.');
  }
}
