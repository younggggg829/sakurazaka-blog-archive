const { chromium } = require('playwright');

async function fetchMembers() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('メンバー一覧を取得中...');

    // ブログページからメンバー一覧を取得
    await page.goto('https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // ページが読み込まれるまで待機
    await page.waitForTimeout(2000);

    const members = await page.evaluate(() => {
      const memberList = [];

      // ct=パラメータを含むリンクをすべて取得
      const allLinks = document.querySelectorAll('a[href*="ct="]');
      const uniqueMembers = new Map();

      allLinks.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim();

        // blog/listページへのリンクで、ct=パラメータがあるもの
        if (href && href.includes('/diary/blog/list') && href.includes('ct=')) {
          const idMatch = href.match(/ct=(\d+)/);

          if (idMatch && text && text.length > 0 && text.length < 20) {
            // 数字だけのIDは除外（00など）
            if (parseInt(idMatch[1]) > 0) {
              // 重複を避けるためMapを使用
              if (!uniqueMembers.has(idMatch[1])) {
                uniqueMembers.set(idMatch[1], {
                  id: idMatch[1],
                  name: text,
                  blogUrl: `https://sakurazaka46.com${href.startsWith('/') ? href : '/' + href}`
                });
              }
            }
          }
        }
      });

      // Mapから配列に変換
      uniqueMembers.forEach(member => {
        memberList.push(member);
      });

      return memberList;
    });

    await browser.close();

    // IDでソート
    members.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    return members;
  } catch (error) {
    console.error('メンバー取得エラー:', error);
    await browser.close();

    // エラー時は現在の既知のメンバーリストを返す
    const knownMembers = [
      { id: '43', name: '井上 梨名' },
      { id: '45', name: '武元 唯衣' },
      { id: '46', name: '田村 保乃' },
      { id: '47', name: '藤吉 夏鈴' },
      { id: '48', name: '松田 里奈' },
      { id: '50', name: '森田 ひかる' },
      { id: '51', name: '山﨑 天' },
      { id: '53', name: '遠藤 光莉' },
      { id: '54', name: '大園 玲' },
      { id: '55', name: '大沼 晶保' },
      { id: '56', name: '幸阪 茉里乃' },
      { id: '57', name: '増本 綺良' },
      { id: '58', name: '守屋 麗奈' },
      { id: '59', name: '石森 璃花' },
      { id: '60', name: '遠藤 理子' },
      { id: '61', name: '小田倉 麗奈' },
      { id: '62', name: '小島 凪紗' },
      { id: '63', name: '谷口 愛季' },
      { id: '64', name: '中嶋 優月' },
      { id: '65', name: '的野 美青' },
      { id: '66', name: '向井 純葉' },
      { id: '67', name: '村井 優' },
      { id: '68', name: '村山 美羽' },
      { id: '69', name: '山下 瞳月' },
      { id: '70', name: '浅井 恋乃未' },
      { id: '71', name: '稲熊 ひな' },
      { id: '72', name: '勝又 春' },
      { id: '73', name: '佐藤 愛桜' },
      { id: '74', name: '中川 智尋' },
      { id: '75', name: '松本 和子' },
      { id: '76', name: '目黒 陽色' },
      { id: '77', name: '山川 宇衣' },
      { id: '78', name: '山田 桃実' }
    ];

    return knownMembers.map(member => ({
      ...member,
      blogUrl: `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&ct=${member.id}`
    }));
  }
}

module.exports = { fetchMembers };

if (require.main === module) {
  fetchMembers().then(members => {
    console.log('Found members:', members);
  });
}