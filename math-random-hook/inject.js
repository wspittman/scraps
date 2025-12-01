(() => {
  const quicken = () => {
    const golden = window.Game?.shimmerTypes?.["golden"];

    if (golden) {
      golden.getTimeModOld = golden.getTimeMod;
      golden.getTimeMod = (me, m) => golden.getTimeModOld(me, m) / 100;
      console.log("Gold hook");
    } else {
      setTimeout(quicken, 1000);
    }
  };
  quicken();
})();
