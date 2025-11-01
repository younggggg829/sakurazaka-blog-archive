const inquirer = require("inquirer").default;
const chalk = require("chalk");
const { chromium } = require("playwright");
const { fetchMembers } = require("./fetchMembers");
const { scrapeBlogPosts } = require("./blogScraper");
const {
  scrapeKeyakiBlogPosts,
  KEYAKI_MEMBER_MAP,
} = require("./keyakiBlogScraper");
const BlogDatabase = require("./database");
const { downloadImagesOptimized } = require("./imageDownloader");
const { startServer } = require("./webServer");

const db = new BlogDatabase();

async function displayMenu() {
  console.clear();
  console.log(chalk.blue.bold("=== Sakurazaka46 Blog Tool ===\n"));

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "👼 Open member blog in browser", value: "open" },
        { name: "🌸 Scrape and save sakurazaka46 blog posts", value: "scrape" },
        {
          name: "🌳 Scrape and save Keyakizaka46 blog posts",
          value: "scrape-keyaki",
        },
        { name: "🔍 Search saved blog posts", value: "search" },
        { name: "🌐 Webページビューアーを起動", value: "web" },
        { name: "❌ Exit", value: "exit" },
      ],
    },
  ]);

  return action;
}

async function listMembers() {
  console.log(chalk.yellow("\nFetching member list from database..."));

  let members = await db.getMembers();

  if (members.length === 0) {
    console.log(
      chalk.yellow("No members in database. Fetching from website...")
    );
    members = await fetchMembers();

    if (members.length > 0) {
      await db.saveMembers(members);
      console.log(chalk.green(`✓ Saved ${members.length} members to database`));
    }
  }

  if (members.length === 0) {
    console.log(chalk.red("Could not fetch members"));
    return null;
  }

  console.log(chalk.green(`\nFound ${members.length} members:\n`));
  members.forEach((member, index) => {
    console.log(`${index + 1}. ${member.name} (ID: ${member.id})`);
  });

  return members;
}

async function selectMember(members = null) {
  if (!members) {
    members = await listMembers();
    if (!members) return null;
  }

  // 選択方法を聞く
  const { method } = await inquirer.prompt([
    {
      type: "list",
      name: "method",
      message: "\nメンバー選択方法:",
      choices: [
        { name: "📝 番号を入力して選択（高速）", value: "number" },
        { name: "🔍 名前で検索して選択", value: "search" },
        { name: "📋 一覧から選択", value: "list" },
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (method === "back") return null;

  if (method === "number") {
    // 番号入力方式
    console.log(chalk.cyan("\n=== メンバー一覧 ==="));
    members.forEach((member, index) => {
      console.log(
        chalk.gray(`${index + 1}. ${member.name} (ID: ${member.id})`)
      );
    });
    console.log(chalk.gray(`0. ← Back\n`));

    const { memberNumber } = await inquirer.prompt([
      {
        type: "input",
        name: "memberNumber",
        message: "番号を入力してください:",
        validate: (value) => {
          const num = parseInt(value);
          if (value === "0") return true;
          if (isNaN(num) || num < 1 || num > members.length) {
            return `1-${members.length}の数値、または0（戻る）を入力してください`;
          }
          return true;
        },
      },
    ]);

    const num = parseInt(memberNumber);
    if (num === 0) return null;
    return members[num - 1];
  } else if (method === "search") {
    // 検索方式
    const { searchTerm } = await inquirer.prompt([
      {
        type: "input",
        name: "searchTerm",
        message: "メンバー名を入力してください（部分一致）:",
        validate: (value) =>
          value.trim().length > 0 || "1文字以上入力してください",
      },
    ]);

    const filtered = members.filter((member) =>
      member.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filtered.length === 0) {
      console.log(chalk.red("該当するメンバーが見つかりませんでした"));
      return await selectMember(members); // 再度選択
    }

    console.log(chalk.green(`\n${filtered.length}件見つかりました:\n`));
    filtered.forEach((member, index) => {
      console.log(`${index + 1}. ${member.name} (ID: ${member.id})`);
    });
    console.log(chalk.gray(`0. ← やり直す\n`));

    if (filtered.length === 1) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `${filtered[0].name}を選択しますか？`,
          default: true,
        },
      ]);
      return confirm ? filtered[0] : await selectMember(members);
    }

    // 複数見つかった場合は番号入力方式
    const { memberNumber } = await inquirer.prompt([
      {
        type: "input",
        name: "memberNumber",
        message: "番号を入力してください:",
        validate: (value) => {
          const num = parseInt(value);
          if (value === "0") return true;
          if (isNaN(num) || num < 1 || num > filtered.length) {
            return `1-${filtered.length}の数値、または0（やり直す）を入力してください`;
          }
          return true;
        },
      },
    ]);

    const num = parseInt(memberNumber);
    if (num === 0) return await selectMember(members);
    return filtered[num - 1];
  } else {
    // 一覧選択方式（従来通り）
    const choices = members.map((member) => ({
      name: `${member.name} (ID: ${member.id})`,
      value: member,
    }));

    const { selectedMember } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedMember",
        message: "\nSelect a member:",
        choices: [...choices, { name: "← Back", value: null }],
        pageSize: 15,
        loop: false, // ループを無効化
      },
    ]);

    return selectedMember;
  }
}

async function openMemberBlog() {
  const member = await selectMember();
  if (!member) return false; // 戻るが選択された

  console.log(chalk.yellow(`\nOpening blog for ${member.name}...`));

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const blogUrl =
    member.blog_url ||
    `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&ct=${member.id}`;

  await page.goto(blogUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  console.log(chalk.green("✓ Blog opened in browser"));

  await inquirer.prompt([
    {
      type: "input",
      name: "close",
      message: "ブラウザを閉じるにはEnterキーを押してください:",
    },
  ]);

  await browser.close();
  console.log(chalk.green("✓ ブラウザを閉じました"));

  // メインメニューに戻る確認
  console.log(
    chalk.yellow(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    )
  );
  await inquirer.prompt([
    {
      type: "confirm",
      name: "backToMenu",
      message: "処理が完了しました。メインメニューに戻ります",
      default: true,
    },
  ]);

  return false;
}

async function scrapeKeyakiMemberBlog() {
  const availableMembers = Object.keys(KEYAKI_MEMBER_MAP);

  // 選択方法を聞く
  const { method } = await inquirer.prompt([
    {
      type: "list",
      name: "method",
      message: "\nメンバー選択方法:",
      choices: [
        { name: "📝 番号を入力して選択（高速）", value: "number" },
        { name: "🔍 名前で検索して選択", value: "search" },
        { name: "📋 一覧から選択", value: "list" },
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (method === "back") return false;

  let selectedMemberName = null;

  if (method === "number") {
    // 番号入力方式
    console.log(chalk.cyan("\n=== 欅坂46メンバー一覧 ==="));
    availableMembers.forEach((name, index) => {
      console.log(chalk.gray(`${index + 1}. ${name}`));
    });
    console.log(chalk.gray(`0. ← Back\n`));

    const { memberNumber } = await inquirer.prompt([
      {
        type: "input",
        name: "memberNumber",
        message: "番号を入力してください:",
        validate: (value) => {
          const num = parseInt(value);
          if (value === "0") return true;
          if (isNaN(num) || num < 1 || num > availableMembers.length) {
            return `1-${availableMembers.length}の数値、または0（戻る）を入力してください`;
          }
          return true;
        },
      },
    ]);

    const num = parseInt(memberNumber);
    if (num === 0) return false;
    selectedMemberName = availableMembers[num - 1];
  } else if (method === "search") {
    // 検索方式
    const { searchTerm } = await inquirer.prompt([
      {
        type: "input",
        name: "searchTerm",
        message: "メンバー名を入力してください（部分一致）:",
        validate: (value) =>
          value.trim().length > 0 || "1文字以上入力してください",
      },
    ]);

    const filtered = availableMembers.filter((name) =>
      name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filtered.length === 0) {
      console.log(chalk.red("該当するメンバーが見つかりませんでした"));
      return await scrapeKeyakiMemberBlog(); // 再度選択
    }

    console.log(chalk.green(`\n${filtered.length}件見つかりました:\n`));
    filtered.forEach((name, index) => {
      console.log(`${index + 1}. ${name}`);
    });
    console.log(chalk.gray(`0. ← やり直す\n`));

    if (filtered.length === 1) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `${filtered[0]}を選択しますか？`,
          default: true,
        },
      ]);

      if (confirm) {
        selectedMemberName = filtered[0];
      } else {
        return await scrapeKeyakiMemberBlog();
      }
    } else {
      // 複数見つかった場合は番号入力方式
      const { memberNumber } = await inquirer.prompt([
        {
          type: "input",
          name: "memberNumber",
          message: "番号を入力してください:",
          validate: (value) => {
            const num = parseInt(value);
            if (value === "0") return true;
            if (isNaN(num) || num < 1 || num > filtered.length) {
              return `1-${filtered.length}の数値、または0（やり直す）を入力してください`;
            }
            return true;
          },
        },
      ]);

      const num = parseInt(memberNumber);
      if (num === 0) return await scrapeKeyakiMemberBlog();
      selectedMemberName = filtered[num - 1];
    }
  } else {
    // 一覧選択方式（従来通り）
    const choices = availableMembers.map((name) => ({
      name: `${name} (欅坂46時代)`,
      value: name,
    }));

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "\n欅坂46のブログをスクレイピングするメンバーを選択:",
        choices: [...choices, { name: "← Back", value: null }],
        pageSize: 15,
        loop: false,
      },
    ]);

    if (!selected) return false;
    selectedMemberName = selected;
  }

  if (!selectedMemberName) return false; // 戻るが選択された

  const { postCount } = await inquirer.prompt([
    {
      type: "input",
      name: "postCount",
      message: 'スクレイピングする記事数を入力（"all"で全件）:',
      default: "5",
      validate: (value) => {
        if (value === "all") return true;
        const num = parseInt(value);
        return (
          (num > 0 && num <= 100) ||
          '1-100の数値、または"all"を入力してください'
        );
      },
    },
  ]);

  const limit = postCount === "all" ? "all" : parseInt(postCount);

  // 日付範囲フィルタリングの確認
  const { useDateFilter } = await inquirer.prompt([
    {
      type: "confirm",
      name: "useDateFilter",
      message: "日付で絞り込みますか？",
      default: false,
    },
  ]);

  let dateFrom = null;
  let dateTo = null;

  if (useDateFilter) {
    const dateAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "dateFrom",
        message: "開始日 (YYYY-MM-DD, 空白で指定なし):",
        default: "",
        validate: (value) => {
          if (!value.trim()) return true;
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(value)) {
            return "YYYY-MM-DD形式で入力してください（例: 2018-01-01）";
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            return "有効な日付を入力してください";
          }
          return true;
        },
      },
      {
        type: "input",
        name: "dateTo",
        message: "終了日 (YYYY-MM-DD, 空白で指定なし):",
        default: "",
        validate: (value) => {
          if (!value.trim()) return true;
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(value)) {
            return "YYYY-MM-DD形式で入力してください（例: 2020-12-31）";
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            return "有効な日付を入力してください";
          }
          return true;
        },
      },
    ]);

    dateFrom = dateAnswers.dateFrom.trim() || null;
    dateTo = dateAnswers.dateTo.trim() || null;
  }

  const { downloadImages } = await inquirer.prompt([
    {
      type: "confirm",
      name: "downloadImages",
      message: "画像をダウンロードしますか？",
      default: true,
    },
  ]);

  const displayCount = limit === "all" ? "全件" : `${limit}件`;
  const dateRangeMsg =
    dateFrom || dateTo
      ? ` (${dateFrom || "指定なし"} 〜 ${dateTo || "指定なし"})`
      : "";
  console.log(
    chalk.yellow(
      `\n${selectedMemberName}さんの欅坂46ブログ記事を${displayCount}スクレイピング中...${dateRangeMsg}`
    )
  );

  const posts = await scrapeKeyakiBlogPosts(selectedMemberName, limit, {
    dateFrom,
    dateTo,
  });

  if (posts.length > 0) {
    console.log(chalk.green(`✓ Scraped ${posts.length} Keyaki posts`));
    console.log(chalk.yellow("Saving to database..."));

    await db.saveBlogPosts(posts);
    console.log(chalk.green("✓ データベースに保存しました"));

    // 画像のダウンロード
    if (downloadImages) {
      console.log(chalk.yellow("\n画像をダウンロード中..."));
      const keyakiMemberId = KEYAKI_MEMBER_MAP[selectedMemberName];

      for (const post of posts) {
        if (post.images && post.images.length > 0) {
          console.log(`\n${post.title}の画像:`);
          const postId = post.url.split("/").pop().split("?")[0];
          const downloaded = await downloadImagesOptimized(
            post.images,
            keyakiMemberId,
            postId,
            selectedMemberName,
            "keyakizaka46"
          );

          // ローカル画像パスをpostsに追加
          const localImagePaths = downloaded
            .filter((d) => d.success)
            .map((d) => d.localPath);
          post.localImages = localImagePaths;

          console.log(
            `  ${downloaded.filter((d) => d.success).length}/${
              post.images.length
            }枚ダウンロード完了`
          );
        }
      }

      // 画像をダウンロードした場合、ローカル画像パスも保存
      for (const post of posts) {
        if (post.localImages && post.localImages.length > 0) {
          await db.updateBlogPostImages(post.url, post.localImages);
        }
      }
    }

    const { showPosts } = await inquirer.prompt([
      {
        type: "confirm",
        name: "showPosts",
        message: "Display scraped posts?",
        default: false,
      },
    ]);

    if (showPosts) {
      posts.forEach((post, index) => {
        console.log(chalk.cyan(`\n--- Keyaki Post ${index + 1} ---`));
        console.log(`Title: ${post.title}`);
        console.log(`Date: ${post.date}`);
        console.log(`Site: ${post.site}`);
        console.log(`Content: ${post.content.substring(0, 200)}...`);
        console.log(`Images: ${post.images.length} image(s)`);
      });
    }
  } else {
    console.log(chalk.red("No Keyaki posts were scraped"));
  }

  // メインメニューに戻る確認
  console.log(
    chalk.yellow(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    )
  );
  await inquirer.prompt([
    {
      type: "confirm",
      name: "backToMenu",
      message: "処理が完了しました。メインメニューに戻ります",
      default: true,
    },
  ]);

  return false;
}

async function scrapeMemberBlog() {
  const member = await selectMember();
  if (!member) return false; // 戻るが選択された

  const { postCount } = await inquirer.prompt([
    {
      type: "input",
      name: "postCount",
      message: 'スクレイピングする記事数を入力（"all"で全件）:',
      default: "5",
      validate: (value) => {
        if (value === "all") return true;
        const num = parseInt(value);
        return (
          (num > 0 && num <= 100) ||
          '1-100の数値、または"all"を入力してください'
        );
      },
    },
  ]);

  const limit = postCount === "all" ? "all" : parseInt(postCount);

  // 日付範囲フィルタリングの確認
  const { useDateFilter } = await inquirer.prompt([
    {
      type: "confirm",
      name: "useDateFilter",
      message: "日付で絞り込みますか？",
      default: false,
    },
  ]);

  let dateFrom = null;
  let dateTo = null;

  if (useDateFilter) {
    const dateAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "dateFrom",
        message: "開始日 (YYYY-MM-DD, 空白で指定なし):",
        default: "",
        validate: (value) => {
          if (!value.trim()) return true; // 空白はOK
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(value)) {
            return "YYYY-MM-DD形式で入力してください（例: 2024-01-01）";
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            return "有効な日付を入力してください";
          }
          return true;
        },
      },
      {
        type: "input",
        name: "dateTo",
        message: "終了日 (YYYY-MM-DD, 空白で指定なし):",
        default: "",
        validate: (value) => {
          if (!value.trim()) return true; // 空白はOK
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(value)) {
            return "YYYY-MM-DD形式で入力してください（例: 2024-12-31）";
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            return "有効な日付を入力してください";
          }
          return true;
        },
      },
    ]);

    dateFrom = dateAnswers.dateFrom.trim() || null;
    dateTo = dateAnswers.dateTo.trim() || null;
  }

  const { downloadImages } = await inquirer.prompt([
    {
      type: "confirm",
      name: "downloadImages",
      message: "画像をダウンロードしますか？",
      default: true,
    },
  ]);

  const displayCount = limit === "all" ? "全件" : `${limit}件`;
  const dateRangeMsg =
    dateFrom || dateTo
      ? ` (${dateFrom || "指定なし"} 〜 ${dateTo || "指定なし"})`
      : "";
  console.log(
    chalk.yellow(
      `\n${member.name}さんのブログ記事を${displayCount}スクレイピング中...${dateRangeMsg}`
    )
  );

  const posts = await scrapeBlogPosts(member.id, member.name, limit, {
    dateFrom,
    dateTo,
  });

  if (posts.length > 0) {
    console.log(chalk.green(`✓ Scraped ${posts.length} posts`));
    console.log(chalk.yellow("Saving to database..."));

    await db.saveBlogPosts(posts);
    console.log(chalk.green("✓ データベースに保存しました"));

    // 画像のダウンロード
    if (downloadImages) {
      console.log(chalk.yellow("\n画像をダウンロード中..."));
      for (const post of posts) {
        if (post.images && post.images.length > 0) {
          console.log(`\n${post.title}の画像:`);
          const postId = post.url.split("/").pop();
          const downloaded = await downloadImagesOptimized(
            post.images,
            member.id,
            postId,
            member.name,
            "sakurazaka46"
          );

          // ローカル画像パスをpostsに追加
          const localImagePaths = downloaded
            .filter((d) => d.success)
            .map((d) => d.localPath);
          post.localImages = localImagePaths;

          console.log(
            `  ${downloaded.filter((d) => d.success).length}/${
              post.images.length
            }枚ダウンロード完了`
          );
        }
      }

      // 画像をダウンロードした場合、ローカル画像パスも保存
      for (const post of posts) {
        if (post.localImages && post.localImages.length > 0) {
          await db.updateBlogPostImages(post.url, post.localImages);
        }
      }
    }

    const { showPosts } = await inquirer.prompt([
      {
        type: "confirm",
        name: "showPosts",
        message: "Display scraped posts?",
        default: false,
      },
    ]);

    if (showPosts) {
      posts.forEach((post, index) => {
        console.log(chalk.cyan(`\n--- Post ${index + 1} ---`));
        console.log(`Title: ${post.title}`);
        console.log(`Date: ${post.date}`);
        console.log(`Content: ${post.content.substring(0, 200)}...`);
        console.log(`Images: ${post.images.length} image(s)`);
      });
    }
  } else {
    console.log(chalk.red("No posts were scraped"));
  }

  // メインメニューに戻る確認
  console.log(
    chalk.yellow(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    )
  );
  await inquirer.prompt([
    {
      type: "confirm",
      name: "backToMenu",
      message: "処理が完了しました。メインメニューに戻ります",
      default: true,
    },
  ]);

  return false;
}

async function searchBlogPosts() {
  const { keyword } = await inquirer.prompt([
    {
      type: "input",
      name: "keyword",
      message: "Enter search keyword:",
      validate: (value) => value.trim().length > 0,
    },
  ]);

  console.log(chalk.yellow(`\nSearching for "${keyword}"...`));

  const posts = await db.searchBlogPosts(keyword);

  if (posts.length > 0) {
    console.log(chalk.green(`\nFound ${posts.length} posts:\n`));

    posts.forEach((post, index) => {
      console.log(chalk.cyan(`--- ${index + 1}. ${post.member_name} ---`));
      console.log(`Title: ${post.title}`);
      console.log(`Date: ${post.date}`);
      console.log(`Content: ${post.content.substring(0, 150)}...`);
      console.log();
    });
  } else {
    console.log(chalk.red("No posts found"));
  }

  // 結果を表示した後、メインメニューに戻る確認
  console.log(
    chalk.yellow("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  );
  await inquirer.prompt([
    {
      type: "confirm",
      name: "backToMenu",
      message: "検索結果を確認しました。メインメニューに戻りますか？",
      default: true,
    },
  ]);

  return false; // shouldWaitはfalseのまま（inquirerで待機済み）
}

async function startWebViewer() {
  console.log(chalk.yellow("\nWebページビューアーを起動中..."));
  startServer();

  // サーバーの起動メッセージが完全に表示されるまで待機
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(chalk.green("\n✓ Webサーバーが起動しました"));

  // メインメニューに戻る確認（分かりやすいメッセージ）
  console.log(
    chalk.yellow(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    )
  );
  await inquirer.prompt([
    {
      type: "confirm",
      name: "backToMenu",
      message: "サーバー起動を確認しました。メインメニューに戻りますか？",
      default: true,
    },
  ]);

  return false; // shouldWaitはfalseのまま（inquirerで待機済み）
}

async function main() {
  console.log(chalk.blue.bold("Starting Sakurazaka46 Blog Tool..."));

  while (true) {
    try {
      const action = await displayMenu();
      let shouldWait = true; // デフォルトでは待機する

      switch (action) {
        case "open":
          shouldWait = await openMemberBlog();
          break;
        case "scrape":
          shouldWait = await scrapeMemberBlog();
          break;
        case "search":
          shouldWait = await searchBlogPosts();
          break;
        case "scrape-keyaki":
          shouldWait = await scrapeKeyakiMemberBlog();
          break;
        case "web":
          shouldWait = await startWebViewer();
          break;
        case "exit":
          console.log(
            chalk.green("\nThank you for using Sakurazaka46 Blog Tool!")
          );
          db.close();
          process.exit(0);
      }

      // 処理が完了した場合のみ待機メッセージを表示
      if (shouldWait) {
        console.log(chalk.yellow("\nEnterキーでメインメニューに戻る..."));
        await new Promise((resolve) => {
          process.stdin.once("data", resolve);
        });
      }
    } catch (error) {
      console.error(chalk.red("Error:"), error);
      console.log(chalk.yellow("\nEnterキーでメインメニューに戻る..."));
      await new Promise((resolve) => {
        process.stdin.once("data", resolve);
      });
    }
  }
}

main().catch((error) => {
  console.error(chalk.red("Fatal error:"), error);
  db.close();
  process.exit(1);
});
