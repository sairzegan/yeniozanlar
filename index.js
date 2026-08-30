// index.js

function analizEt(satirlar, anaTema, kafiyeVar, aliterasyonVar, asonansVar, heceOlcusu, ozgunMetafor, zenginlik, ayniKelimeTekrar, gunlukBulunan, kisilesMeSatirlari, sembolBulunan, temaOrnekSatirlar = []) {
  let p = 5.0; // Varsayılan başlangıç puanı
  
  if(ayniKelimeTekrar.length > 0 && !kafiyeVar) p -= 0.4;

  // Ses ve ahenk unsurları
  if(aliterasyonVar) p += 0.4;
  if(asonansVar) p += 0.4;
  if(heceOlcusu) p += 0.8;
  if(ozgunMetafor) p += 0.8;
  if(kisilesMeSatirlari.length > 0) p += 0.4;
  if(sembolBulunan.length > 0) p += 0.5;

  // Puanı sınırla (2.0 - 9.8 aralığı)
  p = Math.min(9.8, Math.max(2.0, Math.round(p * 10) / 10));

  // Analiz metinlerini oluştur
  const temaAdi = anaTema ? anaTema.isim : 'genel hissiyat';
  const ornekDize = temaOrnekSatirlar[0] ? `"${temaOrnekSatirlar[0]}"` : (satirlar[0] ? `"${satirlar[0]}"` : '');
  
  let yorum = `Bu şiir temel olarak ${temaAdi} ekseninde şekilleniyor. `;
  if(ornekDize) yorum += `${ornekDize} dizesinde olduğu gibi imgeler duygu yoğunluğunu destekliyor. `;
  if(heceOlcusu) yorum += `Şiirde belirgin bir hece akışı ve ses uyumu hissediliyor. `;
  else if(kafiyeVar) yorum += `Dizeler arasında kurulan kafiye bağı metne müzikalite katıyor. `;
  else yorum += `Serbest ölçüyle yazılmış, akışkan bir yapıya sahip. `;
  if(gunlukBulunan.length > 0) yorum += `Dilinde günlük konuşma kalıplarına rastlansa da `;
  yorum += `genel atmosferi şiirsel bir derinlik barındırıyor.`;

  const gucluYon = ornekDize ? `Örn: ${ornekDize}` : (satirlar[0] ? `"${satirlar[0]}"` : 'Özgün ifade denemeleri');
  const oner = zenginlik < 0.5 ? 'Kelime çeşitliliği artırılabilir ve tekrarlardan kaçınılabilir.' : 'İmgeler daha da somutlaştırılabilir.';

  return {
    score: p,
    yorum: yorum.trim(),
    gucluYonler: gucluYon,
    gelistirmeOnerisi: oner
  };
}

export { analizEt };
