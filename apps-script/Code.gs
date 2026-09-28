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

function parseGameTeamNames_(html) {
  var re = /<div class="ba-scoreBoard__teamName">\s*<a[^>]*>([^<]*)<\/a>/g;
  var names = [];
  var m;
  while ((m = re.exec(html)) && names.length < 2) {
    names.push(decodeHtmlEntities_(m[1].trim()));
  }
  return names.length === 2 ? { home: names[0], away: names[1] } : null;
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
  try {
    var sbRes = UrlFetchApp.fetch(widgetUrl_(division, gameId, 'scoreboard'), { muteHttpExceptions: true });
    if (sbRes.getResponseCode() === 200) {
      teams = parseGameTeamNames_(sbRes.getContentText());
    }
  } catch (e) {
    teams = null;
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
    division: DIVISION_LABELS_[division] || division,
    homeRoster: toSortedNums(homeNums),
    awayRoster: toSortedNums(awayNums)
  };
}
