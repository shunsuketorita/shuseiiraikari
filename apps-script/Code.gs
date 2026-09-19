function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('修正依頼テンプレ作成')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
