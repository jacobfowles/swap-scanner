// Panini FIFA World Cup 2026 sticker album: 48 teams x 20 stickers (1 = team
// logo, 13 = team photo, the rest players) plus the FWC specials section.
// Codes are the three-letter codes printed on the stickers, in album order.
(function (root) {
  const TEAMS = [
    // Specials: FWC 00 plus FWC 1-19 (emblem, mascots, hosts, museum history).
    { code: 'FWC', name: 'FIFA World Cup specials', group: '', min: 0, max: 19 },

    { code: 'MEX', name: 'Mexico', group: 'A' },
    { code: 'RSA', name: 'South Africa', group: 'A' },
    { code: 'KOR', name: 'South Korea', group: 'A' },
    { code: 'CZE', name: 'Czechia', group: 'A' },

    { code: 'CAN', name: 'Canada', group: 'B' },
    { code: 'BIH', name: 'Bosnia and Herzegovina', group: 'B' },
    { code: 'QAT', name: 'Qatar', group: 'B' },
    { code: 'SUI', name: 'Switzerland', group: 'B' },

    { code: 'BRA', name: 'Brazil', group: 'C' },
    { code: 'MAR', name: 'Morocco', group: 'C' },
    { code: 'HAI', name: 'Haiti', group: 'C' },
    { code: 'SCO', name: 'Scotland', group: 'C' },

    { code: 'USA', name: 'USA', group: 'D' },
    { code: 'PAR', name: 'Paraguay', group: 'D' },
    { code: 'AUS', name: 'Australia', group: 'D' },
    { code: 'TUR', name: 'Türkiye', group: 'D' },

    { code: 'GER', name: 'Germany', group: 'E' },
    { code: 'CUW', name: 'Curaçao', group: 'E' },
    { code: 'CIV', name: "Côte d'Ivoire", group: 'E' },
    { code: 'ECU', name: 'Ecuador', group: 'E' },

    { code: 'NED', name: 'Netherlands', group: 'F' },
    { code: 'JPN', name: 'Japan', group: 'F' },
    { code: 'SWE', name: 'Sweden', group: 'F' },
    { code: 'TUN', name: 'Tunisia', group: 'F' },

    { code: 'BEL', name: 'Belgium', group: 'G' },
    { code: 'EGY', name: 'Egypt', group: 'G' },
    { code: 'IRN', name: 'Iran', group: 'G' },
    { code: 'NZL', name: 'New Zealand', group: 'G' },

    { code: 'ESP', name: 'Spain', group: 'H' },
    { code: 'CPV', name: 'Cabo Verde', group: 'H' },
    { code: 'KSA', name: 'Saudi Arabia', group: 'H' },
    { code: 'URU', name: 'Uruguay', group: 'H' },

    { code: 'FRA', name: 'France', group: 'I' },
    { code: 'SEN', name: 'Senegal', group: 'I' },
    { code: 'IRQ', name: 'Iraq', group: 'I' },
    { code: 'NOR', name: 'Norway', group: 'I' },

    { code: 'ARG', name: 'Argentina', group: 'J' },
    { code: 'ALG', name: 'Algeria', group: 'J' },
    { code: 'AUT', name: 'Austria', group: 'J' },
    { code: 'JOR', name: 'Jordan', group: 'J' },

    { code: 'POR', name: 'Portugal', group: 'K' },
    { code: 'COD', name: 'DR Congo', group: 'K' },
    { code: 'UZB', name: 'Uzbekistan', group: 'K' },
    { code: 'COL', name: 'Colombia', group: 'K' },

    { code: 'ENG', name: 'England', group: 'L' },
    { code: 'CRO', name: 'Croatia', group: 'L' },
    { code: 'GHA', name: 'Ghana', group: 'L' },
    { code: 'PAN', name: 'Panama', group: 'L' },
  ];

  TEAMS.forEach((t, i) => {
    t.order = i;
    if (t.min === undefined) t.min = 1;
    if (t.max === undefined) t.max = 20;
  });

  const BY_CODE = Object.fromEntries(TEAMS.map(t => [t.code, t]));

  const api = { TEAMS, BY_CODE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaniniTeams = api;
})(this);
