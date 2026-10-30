const copyButton = document.getElementById("copy");

copyButton.addEventListener("click", async () => {
  const text = document.getElementById("prompt").textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied!";
  } catch {
    copyButton.textContent = "Select and copy";
  }
  setTimeout(() => (copyButton.textContent = "Copy"), 2000);
});
