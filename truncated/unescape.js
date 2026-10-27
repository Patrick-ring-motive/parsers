const unescapeFlat = (() => {
  const _ = [].join();
  const x = String.fromCharCode(92);
  const xx = x + x;
  const esc = {
    0: String.fromCharCode(0),
    a: String.fromCharCode(7),
    b: String.fromCharCode(8),
    t: String.fromCharCode(9),
    n: String.fromCharCode(10),
    v: String.fromCharCode(11),
    f: String.fromCharCode(12),
    r: String.fromCharCode(13)
  };
  esc[String.fromCharCode(34)] = String.fromCharCode(34);
  esc[String.fromCharCode(39)] = String.fromCharCode(39);
  Object.freeze(esc);
  return (txt) => {
    txt = String(txt ?? _);
    while (txt.includes(xx)) {
      txt = txt.replaceAll(xx, x);
    }
    for (const char in esc) {
      txt = txt.replaceAll(x + char, esc[char]).replaceAll(x + esc[char], esc[char]);
    }
    return txt;
  };
})();
