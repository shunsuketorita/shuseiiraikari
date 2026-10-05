function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('修正依頼テンプレ作成')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var CORRECTION_SHEET_ID_ = '1Bipu6KVWCZMz6NNSB9LgUcr3RW-boSDnJ1FPK7W_h7g';
var CORRECTION_SHEET_GID_ = 405669701;

// Fallbacks only, used if a header label below can't be found in row 1 of the sheet.
var CORRECTION_SHEET_FIRST_COL_FALLBACK_ = 1; // column A (作業日)
var CORRECTION_SHEET_CONTENT_FIRST_COL_FALLBACK_ = 10; // column J (Q)
var CORRECTION_SHEET_LAST_COL_FALLBACK_ = 18; // column R (修正理由)
var CORRECTION_SHEET_DEFAULT_START_ROW_ = 2; // just below the header row, if the content columns are entirely empty

// Reads row 1 and finds the columns actually in use, so a reordered/resized sheet doesn't
// silently misalign writes — this is why Q/時間/確認内容/… previously drifted after someone
// added or removed blank columns between AWAY and Q.
function findHeaderColumns_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), CORRECTION_SHEET_LAST_COL_FALLBACK_);
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var find = function (matcher) {
    for (var i = 0; i < headerRow.length; i++) {
      if (matcher(String(headerRow[i]).trim())) return i + 1; // 1-indexed column
    }
    return null;
  };
  return {
    firstCol: find(function (l) { return l === '作業日'; }) || CORRECTION_SHEET_FIRST_COL_FALLBACK_,
    contentFirstCol: find(function (l) { return l === 'Q'; }) || CORRECTION_SHEET_CONTENT_FIRST_COL_FALLBACK_,
    lastCol: find(function (l) { return l.indexOf('修正理由') === 0; }) || CORRECTION_SHEET_LAST_COL_FALLBACK_
  };
}

function findNextEmptyContentRow_(sheet, contentFirstCol, lastCol) {
  var maxRow = sheet.getMaxRows();
  var width = lastCol - contentFirstCol + 1;
  var values = sheet.getRange(1, contentFirstCol, maxRow, width).getValues();
  for (var r = values.length - 1; r >= 0; r--) {
    var rowHasContent = values[r].some(function (v) { return String(v).trim() !== ''; });
    if (rowHasContent) return r + 2; // 1-indexed row after this one
  }
  return CORRECTION_SHEET_DEFAULT_START_ROW_;
}

function openCorrectionSheet_() {
  var ss = SpreadsheetApp.openById(CORRECTION_SHEET_ID_);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === CORRECTION_SHEET_GID_) return sheets[i];
  }
  return ss.getSheets()[0];
}

function appendRowsToSheet(tsvText, meta) {
  var lines = String(tsvText || '').split('\n').filter(function (l) { return l.trim() !== ''; });
  if (!lines.length) {
    throw new Error('書き込む内容がありません。');
  }
  meta = meta || {};

  var sheet = openCorrectionSheet_();
  var cols = findHeaderColumns_(sheet);
  var width = cols.lastCol - cols.firstCol + 1;

  var prefixVals = [meta.workDate || '', meta.worker || '', meta.gameDate || '', meta.home || '', meta.away || ''];
  var rows = lines.map(function (line) {
    var rowArr = new Array(width).fill('');
    prefixVals.forEach(function (v, i) { rowArr[(cols.firstCol + i) - cols.firstCol] = v; });
    var cells = line.split('\t');
    for (var i = 0; i < 5; i++) { rowArr[(cols.contentFirstCol + i) - cols.firstCol] = cells[i] || ''; }
    rowArr[cols.lastCol - cols.firstCol] = cells[8] || ''; // 修正理由 is the 9th TSV field
    return rowArr;
  });

  var targetRow = findNextEmptyContentRow_(sheet, cols.contentFirstCol, cols.lastCol);
  sheet.getRange(targetRow, cols.firstCol, rows.length, width).setValues(rows);
  return { count: rows.length, startRow: targetRow };
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

function parseGameTeamNames_(html) {
  var re = /<div class="ba-scoreBoard__teamName">\s*<a[^>]*>([^<]*)<\/a>/g;
  var names = [];
  var m;
  while ((m = re.exec(html)) && names.length < 2) {
    names.push(decodeHtmlEntities_(m[1].trim()));
  }
  return names.length === 2 ? { home: names[0], away: names[1] } : null;
}

function parseGameDate_(html) {
  var m = /<p class="ba-scoreBoard__info">\s*(\d{1,2}\/\d{1,2})/.exec(html);
  return m ? m[1] : null;
}

var BLEAGUE_DIVISIONS_ = ['premier', 'one', 'next'];

function widgetUrl_(division, gameId, page) {
  return 'https://sports.yahoo.co.jp/basket/widget/ds/pc/' + division + '/games/' + gameId + '/' + page + '.html';
}

function resolveDivisionAndFetchText_(input, gameId) {
  var divM = /\/bleague\/(premier|one|next)\//.exec(String(input || ''));
  var candidates = divM ? [divM[1]] : BLEAGUE_DIVISIONS_;
  var lastCode = null;
  for (var i = 0; i < candidates.length; i++) {
    var division = candidates[i];
    var res = UrlFetchApp.fetch(widgetUrl_(division, gameId, 'text_live'), { muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) {
      return { division: division, res: res };
    }
    lastCode = code;
  }
  throw new Error('読み込みに失敗しました(HTTP ' + lastCode + ')。試合IDを確認してください。');
}

function fetchGameText(input) {
  var m = /(\d{5,7})/.exec(String(input || ''));
  if (!m) {
    throw new Error('試合IDが見つかりませんでした。試合ページのURL、または試合IDを入力してください。');
  }
  var gameId = m[1];
  var found = resolveDivisionAndFetchText_(input, gameId);
  var division = found.division;
  var quarters = parseGameWidgetHtml_(found.res.getContentText());
  if (!quarters.length) {
    throw new Error('プレーが見つかりませんでした。試合開始前か、ページの形式が変わった可能性があります。');
  }

  var teams = null;
  var gameDate = null;
  try {
    var sbRes = UrlFetchApp.fetch(widgetUrl_(division, gameId, 'scoreboard'), { muteHttpExceptions: true });
    if (sbRes.getResponseCode() === 200) {
      var sbHtml = sbRes.getContentText();
      teams = parseGameTeamNames_(sbHtml);
      gameDate = parseGameDate_(sbHtml);
    }
  } catch (e) {
    teams = null;
    gameDate = null;
  }

  var homeNums = {}, awayNums = {};
  if (teams) {
    quarters.forEach(function (q) {
      q.plays.forEach(function (p) {
        var pm = /^#(\d+)\s/.exec(p.desc);
        if (!pm) return;
        if (p.team === teams.home) homeNums[pm[1]] = true;
        else if (p.team === teams.away) awayNums[pm[1]] = true;
      });
    });
  }
  var toSortedNums = function (obj) {
    return Object.keys(obj).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
  };

  var DIVISION_LABELS_ = { premier: 'B.PREMIER', one: 'B.ONE', next: 'B.NEXT' };
  return {
    quarters: quarters,
    teams: teams,
    gameDate: gameDate,
    division: DIVISION_LABELS_[division] || division,
    homeRoster: toSortedNums(homeNums),
    awayRoster: toSortedNums(awayNums)
  };
}
