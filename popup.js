document.getElementById("sort").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Analyzing favicons…";
  try {
    const msg = await browser.runtime.sendMessage({ action: "sort" });
    status.textContent = msg;
  } catch (e) {
    status.textContent = "Error: " + e.message;
  }
});
