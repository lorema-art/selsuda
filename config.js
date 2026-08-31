// 두뇌(구글 앱스크립트) 주소 - PC 앱의 DEFAULT_BRAIN 과 동일하게 유지할 것
window.BRAIN = {
  "apiUrl": "https://script.google.com/macros/s/AKfycbzeXe5ZyxvdMVXTE3SfGNb0Uy4FF2ZDWQW5AgR5ivQsCgtdpceMIdnRaWhtOCgj1KQp/exec",
  "questionsUrl": "https://script.google.com/macros/s/AKfycbyb_SUrRREo7GQeUKjsBC_ao1HzuFLIxctB0J8Wiy_97NxkWz64FMm7xFGnvhtsiv3pNQ/exec",
  "coachingUrl": "https://script.google.com/macros/s/AKfycbzlzOVYceS1kyG52X06PpEaV11nMa2h5K1EUYGoK3kfRkTWF2cgympGUcDb-sgv_4kZ/exec",
  "deliveryUrl": "https://script.google.com/macros/s/AKfycbyUifes_3Wa_WKdgnCIYfvO4Ckb9cn6xI-Ne3fPiE-jaB9wBqaG1g17H5KUjvb-Qe11/exec",
  "rechargeUrl": "https://sourcinglab.imweb.me/shop_view?idx=5"
};

// 기수별 1:1 컨설팅 주소 — PC 앱의 INSTRUCTORS 와 같은 값으로 유지할 것.
//  여기에 없는 기수는 컨설팅이 열리지 않는다(다른 강사 시트로 새어 들어가지 않게).
window.COACHING = [
  { name: '유믿음', cohorts: ['찐초보 1기', '찐초보 2기', '찐초보 3기', '찐초보 4기', '찐초보 5기'], url: '' },
  { name: '뷰셀', cohorts: ['뷰셀 1기', '뷰셀 2기'], url: 'https://script.google.com/macros/s/AKfycbzlzOVYceS1kyG52X06PpEaV11nMa2h5K1EUYGoK3kfRkTWF2cgympGUcDb-sgv_4kZ/exec' },
  { name: '미니쌤', cohorts: ['미니쌤 1기', '미니쌤 2기'], url: 'https://script.google.com/macros/s/AKfycbwh9XHGPkn6o7H2Vuk62eHqeyuIPI_IjeTwQHtLo6oAbKUU5UsK94ShE5vuQlDi1eQPvQ/exec' },
];
