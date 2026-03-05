const statusElement = document.querySelector("#engine-status");

async function bootstrap() {
  if (!statusElement) return;

  try {
    const status = await window.electronAPI.pingEngine();
    statusElement.textContent = `Engine status: ${status}`;
  } catch (error) {
    statusElement.textContent = "Engine status: unavailable";
    // Keep console logging explicit during early project bootstrap.
    console.error("Engine ping failed", error);
  }
}

bootstrap();
