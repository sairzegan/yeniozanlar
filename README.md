# Yeni Ozanlar — FLUX görsel sistemi

Pollinations kaldırıldı. Gemini görsel endpointinden bağımsız olarak Hugging Face Inference Providers üzerinden FLUX.1-schnell kullanılır.

Vercel Environment Variable: `HF_TOKEN`
Token permission: `Make calls to Inference Providers`

Akış: Gemini başarısız → FLUX.1-schnell → başarısızsa mevcut GIPHY fallback.
