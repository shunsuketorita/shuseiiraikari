function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('修正依頼テンプレ作成')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function decodeHtmlEntities_(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function parseGameWidgetHtml_(html) {
  var quarters = [];
  var qRe = /<span class="ba-accordion__title">([^<]*)<\/span>([\s\S]*?)(?=<span class="ba-accordion__title">|$)/g;
  var qm;
  while ((qm = qRe.exec(html))) {
    var qName = decodeHtmlEntities_(qm[1].trim());
    var qBody = qm[2];
    var plays = [];
    var liRe = /<li>([\s\S]*?)<\/li>/g;
    var lm;
    while ((lm = liRe.exec(qBody))) {
      var li = lm[1];
      var timeM = /<div class="ba-liveText__time">([^<]*)<\/div>/.exec(li);
      var nameM = /<span class="ba-liveText__name">([^<]*)<\/span>/.exec(li);
      var descM = /<div class="ba-liveText__desc">([^<]*)<\/div>/.exec(li);
      if (!timeM || !nameM || !descM) continue;
      plays.push({
        time: decodeHtmlEntities_(timeM[1].trim()),
        team: decodeHtmlEntities_(nameM[1].trim()),
        desc: decodeHtmlEntities_(descM[1].trim())
      });
    }
    if (plays.length) quarters.push({ name: qName, plays: plays });
  }
  return quarters;
}

function fetchGameText(input) {
  var m = /(\d{5,7})/.exec(String(input || ''));
  if (!m) {
    throw new Error('試合IDが見つかりませんでした。試合ページのURL、または試合IDを入力してください。');
  }
  var gameId = m[1];
  var url = 'https://sports.yahoo.co.jp/basket/widget/ds/pc/premier/games/' + gameId + '/text_live.html';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('読み込みに失敗しました(HTTP ' + code + ')。試合IDを確認してください。');
  }
  var quarters = parseGameWidgetHtml_(res.getContentText());
  if (!quarters.length) {
    throw new Error('プレーが見つかりませんでした。試合開始前か、ページの形式が変わった可能性があります。');
  }
  return quarters;
}
