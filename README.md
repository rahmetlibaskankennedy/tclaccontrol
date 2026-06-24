# TCL AC Control

TCL Home kliması için Siri Shortcuts uyumlu REST API sunucusu.

## Endpoints

Tüm endpoint'ler `?api_key=KEY` veya `X-Api-Key` header'ı gerektirir.

| Endpoint | Açıklama |
|---|---|
| `GET /health` | Sunucu sağlık kontrolü |
| `GET /devices` | Cihaz listesi (device_id almak için) |
| `GET /ac/on?temp=24&mode=cool` | Klimayı aç |
| `GET /ac/off` | Klimayı kapat |
| `GET /ac/temp?value=22` | Sıcaklık ayarla (18-30) |
| `GET /ac/mode?value=cool` | Mod: cool/heat/fan/dry/auto |

## Kurulum

```bash
git clone https://github.com/tcl-iffalcon/tcl-ac-control
cd tcl-ac-control
npm install
cp .env.example .env
# .env dosyasını düzenle
npm start
```

## Siri Shortcuts

1. iPhone'da Kısayollar uygulamasını aç
2. Yeni kısayol → "URL İçeriğini Al" eylemi ekle
3. URL: `https://senin-sunucun.render.com/ac/on?api_key=KEY`
4. Kısayola Türkçe isim ver: "Klimayı Aç"
5. Siri'ye Ekle
