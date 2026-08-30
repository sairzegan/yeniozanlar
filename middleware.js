export const config = {
  matcher: ['/post/:slug*'],
};

const BOT_RE = /(facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot|Pinterestbot|Applebot|Embedly|redditbot)/i;

export default function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\/post\//, '');

  if (BOT_RE.test(ua)) {
    const target = new URL('/api/postPreview', request.url);
    target.searchParams.set('slug', slug);
    return Response.rewrite(target);
  }

  return Response.rewrite(new URL('/index.html', request.url));
}
