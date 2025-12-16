const { LiveChat } = require("youtube-chat");
const fetch = require("node-fetch");
require("dotenv").config();

const CHANNEL_NAME = process.env.YOUTUBE_CHANNEL_NAME;

let attempts = 0;
const MAX_ATTEMPTS = 3;

async function getLiveVideoIds(channelName) {
  try {
    const url = `https://www.youtube.com/${channelName}/streams`;
    console.log(`🔍 [YouTube] Cerco live IDs su ${url}...`);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status}`);
    }

    const html = await res.text();
    const match = html.match(/var ytInitialData = ({.*?});/);
    if (!match || !match[1]) {
      throw new Error("Impossibile trovare ytInitialData.");
    }

    const data = JSON.parse(match[1]);
    const videoIds = [];

    // Traverse JSON safely
    const tabs =
      data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const streamsTab = tabs.find(
      (t) => t.tabRenderer?.content?.richGridRenderer
    );

    if (streamsTab) {
      const contents =
        streamsTab.tabRenderer.content.richGridRenderer.contents || [];

      contents.forEach((item) => {
        const videoRenderer = item.richItemRenderer?.content?.videoRenderer;
        if (videoRenderer) {
          // Check for LIVE badge
          const isLive = videoRenderer.thumbnailOverlays?.some(
            (overlay) =>
              overlay.thumbnailOverlayTimeStatusRenderer?.style ===
              "LIVE"
          );

          if (isLive && videoRenderer.videoId) {
            videoIds.push(videoRenderer.videoId);
          }
        }
      });
    }

    return videoIds;
  } catch (e) {
    console.error(`⚠️ Scraping /streams fallito: ${e.message}`);
    // Fallback: try the /live endpoint if scraping fails, returning just one ID
    try {
      const singleId = await getLiveVideoId(channelName);
      return [singleId];
    } catch {
      return [];
    }
  }
}

// Keep the old single scraper as a fallback
async function getLiveVideoId(channelName) {
  const url = `https://www.youtube.com/${channelName}/live`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error("HTTP Error");
  const html = await res.text();
  const match = html.match(/"videoId":"([^"]+)"/);
  if (match) return match[1];
  const matchCanonical = html.match(
    /link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([^"]+)"/
  );
  if (matchCanonical) return matchCanonical[1];
  throw new Error("Not found");
}

async function connectYouTube(onMessage) {
  if (attempts >= MAX_ATTEMPTS) {
    console.log(
      `❌ [YouTube] Rinuncio alla connessione dopo ${MAX_ATTEMPTS} tentativi.`
    );
    return;
  }

  attempts++;
  console.log(
    `🔗 [YouTube] Tentativo di scoperta live ${attempts}/${MAX_ATTEMPTS}...`
  );

  try {
    const videoIds = await getLiveVideoIds(CHANNEL_NAME);

    if (videoIds.length === 0) {
      console.log("⚠️ [YouTube] Nessuna live trovata.");
      scheduleRetry(onMessage);
      return;
    }

    console.log(`📡 [YouTube] Trovate ${videoIds.length} live: ${videoIds.join(", ")}`);

    // Connect to all found lives
    videoIds.forEach(videoId => connectToStream(videoId, onMessage));

  } catch (err) {
    console.error(`❌ [YouTube] Errore generale:`, err.message);
    scheduleRetry(onMessage);
  }
}

function connectToStream(videoId, onMessage) {
  const liveChat = new LiveChat({ liveId: videoId });

  liveChat.on("start", (liveId) => {
    console.log(`✅ [YouTube] Connesso alla chat (Video: ${liveId})`);
    attempts = 0; // Reset discovery attempts on success of at least one
  });

  liveChat.on("chat", (chatItem) => {
    const text = chatItem.message
      .map((part) => part.text || "")
      .join("");

    const msg = {
      id: chatItem.id,
      authorDetails: {
        channelId: chatItem.author.channelId,
        displayName: chatItem.author.name,
        profileImageUrl: chatItem.author.thumbnail?.url,
      },
      snippet: {
        displayMessage: text,
      },
    };
    onMessage(msg);
  });

  liveChat.on("error", (err) => {
    console.error(`‼️ [YouTube] Errore stream ${videoId}:`, err);
  });

  liveChat.on("end", (reason) => {
    console.log(`❌ [YouTube] Disconnesso ${videoId}: ${reason}`);
  });

  liveChat.start().then(ok => {
    if (!ok) console.log(`❌ [YouTube] Fallito avvio chat per ${videoId}`);
  });
}

function scheduleRetry(onMessage) {
  setTimeout(() => connectYouTube(onMessage), 5000);
}

module.exports = { connectYouTube };
