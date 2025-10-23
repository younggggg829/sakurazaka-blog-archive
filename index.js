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
        { name: "🌐 Open member blog in browser", value: "open" },
        { name: "💾 Scrape and save sakurazaka46 blog posts", value: "scrape" },
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
    },
  ]);

  return selectedMember;
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

  // 3秒後に自動的にメインメニューに戻る
  console.log(chalk.gray("\n3秒後にメインメニューに戻ります..."));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return false;
}

async function scrapeKeyakiMemberBlog() {
  console.log(
    chalk.yellow("\n欅坂46メンバーで欅坂46時代のブログがあるメンバー:")
  );

  const availableMembers = Object.keys(KEYAKI_MEMBER_MAP);
  availableMembers.forEach((name, index) => {
    console.log(`${index + 1}. ${name}`);
  });

  const choices = availableMembers.map((name) => ({
    name: `${name} (欅坂46時代)`,
    value: name,
  }));

  const { selectedMemberName } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedMemberName",
      message: "\n欅坂46のブログをスクレイピングするメンバーを選択:",
      choices: [...choices, { name: "← Back", value: null }],
      pageSize: 15,
    },
  ]);

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
  const { downloadImages } = await inquirer.prompt([
    {
      type: "confirm",
      name: "downloadImages",
      message: "画像をダウンロードしますか？",
      default: false,
    },
  ]);

  const displayCount = limit === "all" ? "全件" : `${limit}件`;
  console.log(
    chalk.yellow(
      `\n${selectedMemberName}さんの欅坂46ブログ記事を${displayCount}スクレイピング中...`
    )
  );

  const posts = await scrapeKeyakiBlogPosts(selectedMemberName, limit);

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
      console.log(chalk.yellow("ローカル画像パスを更新中..."));
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
        default: true,
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

  // 3秒後に自動的にメインメニューに戻る
  console.log(chalk.gray("\n3秒後にメインメニューに戻ります..."));
  await new Promise((resolve) => setTimeout(resolve, 3000));
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
  const { downloadImages } = await inquirer.prompt([
    {
      type: "confirm",
      name: "downloadImages",
      message: "画像をダウンロードしますか？",
      default: false,
    },
  ]);

  const displayCount = limit === "all" ? "全件" : `${limit}件`;
  console.log(
    chalk.yellow(
      `\n${member.name}さんのブログ記事を${displayCount}スクレイピング中...`
    )
  );

  const posts = await scrapeBlogPosts(member.id, member.name, limit);

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
      console.log(chalk.yellow("ローカル画像パスを更新中..."));
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
        default: true,
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

  // 3秒後に自動的にメインメニューに戻る
  console.log(chalk.gray("\n3秒後にメインメニューに戻ります..."));
  await new Promise((resolve) => setTimeout(resolve, 3000));
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

  // 結果を表示した後、自動的にメインメニューに戻る
  console.log(chalk.gray("\n3秒後にメインメニューに戻ります..."));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return false;
}

async function startWebViewer() {
  console.log(chalk.yellow("\nWebページビューアーを起動中..."));
  startServer();
  console.log(chalk.green("\n✓ Webサーバーが起動しました"));
  console.log(
    chalk.cyan("  ブラウザで http://localhost:3000 にアクセスしてください")
  );
  console.log(chalk.gray("  サーバーはバックグラウンドで動作し続けます"));

  // 3秒後に自動的にメインメニューに戻る
  console.log(chalk.gray("\n3秒後にメインメニューに戻ります..."));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return false;
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
