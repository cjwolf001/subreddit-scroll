const form = document.querySelector("#subredditForm");
const input = document.querySelector("#subredditInput");
const statusEl = document.querySelector("#status");
const searchView = document.querySelector("#searchView");
const feedView = document.querySelector("#feedView");
const feed = document.querySelector("#feed");
const feedTitle = document.querySelector("#feedTitle");
const backButton = document.querySelector("#backButton");
const template = document.querySelector("#postTemplate");

let currentSubreddit = "";
let after = "";
let loading = false;
let reachedEnd = false;
const fittedMedia = new Set();
const observedVideos = new Set();
let videoObserver;
let jsonpRequestId = 0;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function normalizeSubreddit(value) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?reddit\.com\/r\//i, "")
    .replace(/^\/?r\//i, "")
    .replace(/\/.*$/, "");
}

function decodeHtml(value = "") {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function htmlToElement(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = decodeHtml(html);
  return wrapper.querySelector("iframe");
}

function getBestPreviewImage(post) {
  const image = post.preview?.images?.[0];
  const source = image?.variants?.gif?.source || image?.source;
  return source?.url ? decodeHtml(source.url) : "";
}

function getSingleGalleryImage(post) {
  const firstItemId = post.gallery_data?.items?.[0]?.media_id;
  const metadata = firstItemId
    ? post.media_metadata?.[firstItemId]
    : Object.values(post.media_metadata || {})[0];

  if (metadata?.e && metadata.e !== "Image") return "";

  const source = metadata?.s?.u || metadata?.s?.gif || metadata?.s?.mp4;
  return source ? decodeHtml(source) : "";
}

function getGalleryImages(post) {
  const items = post.gallery_data?.items || [];
  const metadata = post.media_metadata || {};

  return items
    .map((item) => {
      const itemMetadata = metadata[item.media_id];
      if (itemMetadata?.e && itemMetadata.e !== "Image") return "";
      const source = itemMetadata?.s;
      const url = source?.u || source?.gif || source?.mp4 || "";
      return url ? decodeHtml(url) : "";
    })
    .filter(Boolean);
}

function getGalleryCount(post) {
  return post.gallery_data?.items?.length || Object.keys(post.media_metadata || {}).length;
}

function redditEmbedUrl(post) {
  const permalink = String(post.permalink || "").replace(/\/$/, "");
  return `https://www.redditmedia.com${permalink}?ref_source=embed&ref=share&embed=true&theme=dark`;
}

function youtubeEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    let id = "";
    if (parsed.hostname.includes("youtu.be")) id = parsed.pathname.slice(1);
    if (parsed.hostname.includes("youtube.com")) id = parsed.searchParams.get("v") || parsed.pathname.split("/").pop();
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : "";
  } catch {
    return "";
  }
}

function iframeFor(src, title, className = "") {
  const iframe = document.createElement("iframe");
  iframe.className = className || "media-embed";
  iframe.src = src;
  iframe.title = title;
  iframe.loading = "lazy";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  if (!iframe.classList.contains("embed-post")) {
    requestAnimationFrame(() => fitElementToShell(iframe, 16, 9));
  }
  return iframe;
}

function videoFor(src, poster = "") {
  const video = document.createElement("video");
  video.className = "media-video";
  video.poster = poster;
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.addEventListener("loadedmetadata", () => fitVideoToShell(video), { once: true });
  video.src = src;
  return video;
}

function imageFor(src, alt) {
  const image = document.createElement("img");
  image.className = "media-image";
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("load", () => fitImageToShell(image), { once: true });
  image.src = src;
  return image;
}

function galleryForPost(post, images) {
  const gallery = document.createElement("div");
  gallery.className = "gallery-viewer";

  const image = imageFor(images[0], post.title || "Reddit gallery image");
  const previous = document.createElement("button");
  const next = document.createElement("button");
  const count = document.createElement("span");
  let index = 0;

  previous.type = "button";
  previous.className = "gallery-button gallery-button-previous";
  previous.setAttribute("aria-label", "Previous image");
  previous.textContent = "<";

  next.type = "button";
  next.className = "gallery-button gallery-button-next";
  next.setAttribute("aria-label", "Next image");
  next.textContent = ">";

  count.className = "gallery-count";

  function update(delta = 0) {
    index = (index + delta + images.length) % images.length;
    image.addEventListener("load", () => fitImageToShell(image), { once: true });
    image.src = images[index];
    count.textContent = `${index + 1} / ${images.length}`;
  }

  previous.addEventListener("click", () => update(-1));
  next.addEventListener("click", () => update(1));
  update();

  gallery.append(image, previous, next, count);
  return gallery;
}

function fitImageToShell(image) {
  fitElementToShell(image, image.naturalWidth, image.naturalHeight);
}

function fitVideoToShell(video) {
  fitElementToShell(video, video.videoWidth, video.videoHeight);
}

function fitElementToShell(element, naturalWidth, naturalHeight) {
  const shell = element.closest(".media-shell");
  if (!shell || !naturalWidth || !naturalHeight) return;
  const shellRect = shell.getBoundingClientRect();
  const mediaRatio = naturalWidth / naturalHeight;
  const shellRatio = shellRect.width / shellRect.height;

  let width;
  let height;

  if (shellRatio > mediaRatio) {
    height = shellRect.height;
    width = height * mediaRatio;
  } else {
    width = shellRect.width;
    height = width / mediaRatio;
  }

  element.style.width = `${Math.floor(width)}px`;
  element.style.height = `${Math.floor(height)}px`;
  fittedMedia.add(element);
}

function refitMedia() {
  fittedMedia.forEach((element) => {
    if (element instanceof HTMLImageElement) fitImageToShell(element);
    if (element instanceof HTMLVideoElement) fitVideoToShell(element);
    if (element instanceof HTMLIFrameElement && !element.classList.contains("embed-post")) {
      fitElementToShell(element, 16, 9);
    }
  });
}

function fitMediaTree(root) {
  root.querySelectorAll("img").forEach((image) => {
    if (image.complete) fitImageToShell(image);
  });

  root.querySelectorAll("video").forEach((video) => {
    if (video.readyState >= 1) fitVideoToShell(video);
  });

  root.querySelectorAll("iframe:not(.embed-post)").forEach((iframe) => {
    fitElementToShell(iframe, 16, 9);
  });
}

function muteAndPauseVideo(video) {
  video.muted = true;
  video.pause();
}

function playActiveVideo(video) {
  observedVideos.forEach((candidate) => {
    if (candidate !== video) muteAndPauseVideo(candidate);
  });

  video.muted = false;
  video.volume = 1;

  const playPromise = video.play();
  if (playPromise) {
    playPromise.catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
  }
}

function setupVideoObserver() {
  if (videoObserver) videoObserver.disconnect();

  videoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const post = entry.target;
      const video = post.querySelector("video");
      if (!video) return;

      if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
        playActiveVideo(video);
      } else {
        muteAndPauseVideo(video);
      }
    });
  }, {
    root: feed,
    threshold: [0, 0.35, 0.65, 0.9]
  });
}

function observePostVideos(postNode) {
  const videos = postNode.querySelectorAll("video");
  if (!videos.length) return;

  if (!videoObserver) setupVideoObserver();

  videos.forEach((video) => {
    observedVideos.add(video);
    muteAndPauseVideo(video);
  });

  videoObserver.observe(postNode);
}

function redditListingUrl(subreddit, afterToken) {
  const params = new URLSearchParams({
    limit: "18",
    raw_json: "1"
  });
  if (afterToken) params.set("after", afterToken);

  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?${params}`;
}

function loadRedditJsonp(subreddit, afterToken) {
  return new Promise((resolve, reject) => {
    const callbackName = `redditJsonp_${Date.now()}_${jsonpRequestId++}`;
    const url = new URL(redditListingUrl(subreddit, afterToken));
    url.searchParams.set("jsonp", callbackName);

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Reddit took too long to respond."));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.src = url.toString();
    script.onerror = () => {
      cleanup();
      reject(new Error("Could not load Reddit from this browser."));
    };

    document.head.append(script);
  });
}

async function loadRedditViaRelay(subreddit, afterToken) {
  const redditUrl = redditListingUrl(subreddit, afterToken);
  const relayUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(redditUrl)}`;
  const response = await fetch(relayUrl);
  if (!response.ok) throw new Error(`Reddit relay returned ${response.status}.`);
  return response.json();
}

async function loadRedditListing(subreddit, afterToken) {
  try {
    return await loadRedditJsonp(subreddit, afterToken);
  } catch {
    return loadRedditViaRelay(subreddit, afterToken);
  }
}

function textFallback(post) {
  const div = document.createElement("div");
  div.className = "text-fallback";
  div.textContent = post.selftext || post.title || "Open this post on Reddit.";
  return div;
}

function mediaForPost(post) {
  const title = post.title || "Reddit post";
  const url = post.url_overridden_by_dest || post.url || "";
  const preview = getBestPreviewImage(post);
  const singleGalleryImage = getSingleGalleryImage(post);
  const galleryImages = getGalleryImages(post);
  const richIframe = post.secure_media_embed?.content ? htmlToElement(post.secure_media_embed.content) : null;
  const redditVideo = post.secure_media?.reddit_video || post.media?.reddit_video;
  const galleryCount = getGalleryCount(post);

  if (galleryCount > 1) {
    if (galleryImages.length > 1) {
      return galleryForPost(post, galleryImages);
    }

    return iframeFor(redditEmbedUrl(post), title, "embed-post");
  }

  if (redditVideo?.fallback_url) {
    return videoFor(decodeHtml(redditVideo.fallback_url), preview);
  }

  const youtube = youtubeEmbedUrl(url);
  if (youtube) {
    return iframeFor(youtube, title);
  }

  if (richIframe?.src) {
    richIframe.title = title;
    richIframe.loading = "lazy";
    richIframe.allowFullscreen = true;
    return richIframe;
  }

  if (/\.gifv($|\?)/i.test(url)) {
    return videoFor(url.replace(/\.gifv($|\?)/i, ".mp4$1"), preview);
  }

  if (/\.(mp4|webm|mov)($|\?)/i.test(url)) {
    return videoFor(url, preview);
  }

  if (/\.gif($|\?)/i.test(url)) {
    return imageFor(url, title);
  }

  if (/\.(png|jpe?g|webp|avif)($|\?)/i.test(url)) {
    return imageFor(url, title);
  }

  if (singleGalleryImage) {
    return imageFor(singleGalleryImage, title);
  }

  if (preview) {
    return imageFor(preview, title);
  }

  if (post.is_self) {
    return textFallback(post);
  }

  return iframeFor(redditEmbedUrl(post), title, "embed-post");
}

function formatDetails(post) {
  const score = Number(post.score || 0).toLocaleString();
  const comments = Number(post.num_comments || 0).toLocaleString();
  const author = post.author ? `u/${post.author}` : "unknown author";
  return `${score} points · ${comments} comments · ${author}`;
}

function renderPost(post) {
  const node = template.content.firstElementChild.cloneNode(true);
  const mediaShell = node.querySelector(".media-shell");
  const title = node.querySelector(".post-title");
  const details = node.querySelector(".post-details");

  const media = mediaForPost(post);
  if (media.tagName === "IFRAME" && !media.classList.contains("embed-post")) {
    mediaShell.classList.add("has-direct-embed");
    media.classList.add("media-embed");
    requestAnimationFrame(() => fitElementToShell(media, 16, 9));
  }

  mediaShell.append(media);
  requestAnimationFrame(() => fitMediaTree(mediaShell));
  observePostVideos(node);
  title.textContent = post.title || "Untitled post";
  title.href = `https://www.reddit.com${post.permalink || ""}`;
  details.textContent = formatDetails(post);

  return node;
}

async function loadMore() {
  if (loading || reachedEnd || !currentSubreddit) return;
  loading = true;

  try {
    const payload = await loadRedditListing(currentSubreddit, after);

    if (payload.error) throw new Error(payload.message || payload.error);

    const listing = payload.data;
    const posts = listing.children.map((child) => child.data);
    after = listing.after || "";
    reachedEnd = !after;

    const fragment = document.createDocumentFragment();
    posts.forEach((post) => fragment.append(renderPost(post)));
    feed.append(fragment);

    if (posts.length === 0 && feed.childElementCount === 0) {
      throw new Error("No posts were returned for this subreddit.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showSearch();
    setStatus(message, true);
  } finally {
    loading = false;
  }
}

function showFeed(subreddit) {
  currentSubreddit = subreddit;
  after = "";
  loading = false;
  reachedEnd = false;
  observedVideos.forEach(muteAndPauseVideo);
  observedVideos.clear();
  setupVideoObserver();
  feed.replaceChildren();
  feedTitle.textContent = `r/${subreddit}`;
  searchView.classList.add("is-hidden");
  feedView.classList.remove("is-hidden");
  loadMore();
}

function showSearch() {
  feedView.classList.add("is-hidden");
  searchView.classList.remove("is-hidden");
  input.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const subreddit = normalizeSubreddit(input.value);

  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
    setStatus("Use a valid subreddit name, like videos or pics.", true);
    return;
  }

  input.value = subreddit;
  setStatus("Loading newest posts...");
  showFeed(subreddit);
});

backButton.addEventListener("click", () => {
  currentSubreddit = "";
  showSearch();
  setStatus("Enter a subreddit name to start from the newest posts.");
});

feed.addEventListener("scroll", () => {
  const remaining = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  if (remaining < feed.clientHeight * 2.5) {
    loadMore();
  }
});

window.addEventListener("resize", refitMedia);
