# TCL AC Control

TCL Home kliması için **Siri Shortcuts** uyumlu REST API sunucusu.  
Railway üzerinde çalışır, iPhone’dan tek dokunuşla klima kontrolü sağlar.

-----

## Özellikler

- ✅ TCL Home hesabıyla kimlik doğrulama
- ✅ Klimayı aç / kapat
- ✅ Sıcaklık ve mod ayarı
- ✅ API Key ile güvenli erişim
- ✅ Siri Shortcuts ile tam uyumlu
- ✅ Railway üzerinde ücretsiz deploy

-----

## Endpoints

Tüm endpoint’ler `?api_key=KEY` parametresi veya `X-Api-Key` header’ı gerektirir.

|Endpoint                      |Açıklama                                         |
|------------------------------|-------------------------------------------------|
|`GET /health`                 |Sunucu sağlık kontrolü                           |
|`GET /devices`                |Cihaz listesi (device_id almak için)             |
|`GET /ac/on?temp=24&mode=cool`|Klimayı aç                                       |
|`GET /ac/off`                 |Klimayı kapat                                    |
|`GET /ac/temp?value=22`       |Sıcaklık ayarla (18–30)                          |
|`GET /ac/mode?value=cool`     |Mod seç: `cool` / `heat` / `fan` / `dry` / `auto`|

-----

## Kurulum

### 🚀 Railway ile Deploy (Önerilen)

**1. Repoyu fork’la**

GitHub’da sağ üst köşeden **Fork** butonuna bas, kendi hesabına kopyala.

**2. Railway’de yeni proje oluştur**

[railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → fork’ladığın repoyu seç.

Railway, `package.json` içindeki `npm start` komutunu otomatik olarak çalıştırır.

**3. Environment Variables ekle**

Railway panelinde **Variables** sekmesine geç ve aşağıdaki değişkenleri ekle:

|Değişken       |Açıklama                                        |Örnek              |
|---------------|------------------------------------------------|-------------------|
|`API_KEY`      |API erişim anahtarın (istediğin bir şifre)      |`gizli-anahtar-123`|
|`PORT`         |Sunucu portu — Railway otomatik atar, elle girme|`3000`             |
|`TCL_DEVICE_ID`|TCL Home’dan alınan cihaz ID’si                 |`DNDi_RFAAAE...`   |
|`TCL_EMAIL`    |TCL Home hesap e-postası                        |`ornek@gmail.com`  |
|`TCL_PASSWORD` |TCL Home hesap şifresi                          |`şifren`           |


> **TCL_DEVICE_ID nasıl bulunur?**  
> Değişkenleri kaydedip deploy ettikten sonra:  
> `https://proje-adin.up.railway.app/devices?api_key=API_KEY`  
> adresine git, dönen JSON içindeki `id` değerini `TCL_DEVICE_ID` olarak kaydet ve tekrar deploy et.

**4. Deploy et**

Değişkenleri girdikten sonra **Deploy** butonuna bas.  
Deploy tamamlandığında Railway sana bir URL verir:

```
https://proje-adin.up.railway.app
```

Sağlık kontrolü için:

```
https://proje-adin.up.railway.app/health?api_key=API_KEY
```

-----

### 💻 Lokal Kurulum

```bash
git clone https://github.com/rahmetlibaskankennedy/tclaccontrol
cd tclaccontrol
npm install
```

`.env` dosyasını düzenle:

```env
API_KEY=gizli-anahtar-123
PORT=3000
TCL_DEVICE_ID=cihaz-id-buraya
TCL_EMAIL=ornek@gmail.com
TCL_PASSWORD=şifren
```

Sunucuyu başlat:

```bash
npm start
```

-----

## Siri Shortcuts Kurulumu

1. iPhone’da **Kısayollar** uygulamasını aç
1. **+** → **Eylem Ekle** → `URL İçeriğini Al` seç
1. URL alanına gir:

```
https://proje-adin.up.railway.app/ac/on?api_key=API_KEY&temp=24&mode=cool
```

1. Kısayola Türkçe bir isim ver: **“Klimayı Aç”**
1. **Siri’ye Ekle** → sesli komutunu kaydet

### Hazır Kısayol Örnekleri

|Kısayol Adı    |URL                                   |
|---------------|--------------------------------------|
|Klimayı Aç     |`/ac/on?temp=24&mode=cool&api_key=KEY`|
|Klimayı Kapat  |`/ac/off?api_key=KEY`                 |
|Isıtma Modu    |`/ac/on?temp=22&mode=heat&api_key=KEY`|
|Sıcaklık 20 Yap|`/ac/temp?value=20&api_key=KEY`       |

-----

## Bağımlılıklar

|Paket         |Kullanım              |
|--------------|----------------------|
|`express`     |HTTP sunucusu         |
|`axios`       |TCL Home API istekleri|
|`jsonwebtoken`|Token doğrulama       |
|`aws-sdk`     |AWS entegrasyonu      |

-----

## Lisans

MIT
