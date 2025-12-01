(() => {
  const orig = Math.random;
  Math.random = function () {
    return orig() * orig() * orig();
  };
  try {
    Object.defineProperty(Math, "random", {
      writable: false,
      configurable: false,
    });
  } catch {}
  window._origRandom = orig;
  console.log("[MAIN] Math.random hooked");
})();
