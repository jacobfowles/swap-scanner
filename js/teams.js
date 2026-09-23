// Panini FIFA World Cup 2026 sticker album: 48 teams x 20 stickers (1 = team
// logo, 13 = team photo, the rest players) plus the FWC specials section.
// Codes are the three-letter codes printed on the stickers, in album order.
(function (root) {
  const TEAMS = [
    // Specials: FWC 00 plus FWC 1-19 (emblem, mascots, hosts, museum history).
    // No aliases: every sticker back says "FIFA WORLD CUP 2026".
    { code: 'FWC', name: 'FIFA World Cup specials', group: '', min: 0, max: 19, aliases: [] },

    { code: 'MEX', name: 'Mexico', group: 'A', aliases: ['MEXICO'] },
    { code: 'RSA', name: 'South Africa', group: 'A', aliases: ['SOUTH AFRICA'] },
    { code: 'KOR', name: 'South Korea', group: 'A', aliases: ['KOREA REPUBLIC', 'SOUTH KOREA', 'KOREA'] },
    { code: 'CZE', name: 'Czechia', group: 'A', aliases: ['CZECHIA', 'CZECH REPUBLIC'] },

    { code: 'CAN', name: 'Canada', group: 'B', aliases: ['CANADA'] },
    { code: 'BIH', name: 'Bosnia and Herzegovina', group: 'B', aliases: ['BOSNIA AND HERZEGOVINA', 'BOSNIA'] },
    { code: 'QAT', name: 'Qatar', group: 'B', aliases: ['QATAR'] },
    { code: 'SUI', name: 'Switzerland', group: 'B', aliases: ['SWITZERLAND'] },

    { code: 'BRA', name: 'Brazil', group: 'C', aliases: ['BRAZIL', 'BRASIL'] },
    { code: 'MAR', name: 'Morocco', group: 'C', aliases: ['MOROCCO'] },
    { code: 'HAI', name: 'Haiti', group: 'C', aliases: ['HAITI'] },
    { code: 'SCO', name: 'Scotland', group: 'C', aliases: ['SCOTLAND'] },

    { code: 'USA', name: 'USA', group: 'D', aliases: ['UNITED STATES', 'USA'] },
    { code: 'PAR', name: 'Paraguay', group: 'D', aliases: ['PARAGUAY'] },
    { code: 'AUS', name: 'Australia', group: 'D', aliases: ['AUSTRALIA'] },
    { code: 'TUR', name: 'Türkiye', group: 'D', aliases: ['TURKIYE', 'TURKEY'] },

    { code: 'GER', name: 'Germany', group: 'E', aliases: ['GERMANY'] },
    { code: 'CUW', name: 'Curaçao', group: 'E', aliases: ['CURACAO'] },
    { code: 'CIV', name: "Côte d'Ivoire", group: 'E', aliases: ['COTE DIVOIRE', 'IVORY COAST'] },
    { code: 'ECU', name: 'Ecuador', group: 'E', aliases: ['ECUADOR'] },

    { code: 'NED', name: 'Netherlands', group: 'F', aliases: ['NETHERLANDS', 'HOLLAND'] },
    { code: 'JPN', name: 'Japan', group: 'F', aliases: ['JAPAN'] },
    { code: 'SWE', name: 'Sweden', group: 'F', aliases: ['SWEDEN'] },
    { code: 'TUN', name: 'Tunisia', group: 'F', aliases: ['TUNISIA'] },

    { code: 'BEL', name: 'Belgium', group: 'G', aliases: ['BELGIUM'] },
    { code: 'EGY', name: 'Egypt', group: 'G', aliases: ['EGYPT'] },
    { code: 'IRN', name: 'Iran', group: 'G', aliases: ['IR IRAN', 'IRAN'] },
    { code: 'NZL', name: 'New Zealand', group: 'G', aliases: ['NEW ZEALAND'] },

    { code: 'ESP', name: 'Spain', group: 'H', aliases: ['SPAIN', 'ESPANA'] },
    { code: 'CPV', name: 'Cabo Verde', group: 'H', aliases: ['CABO VERDE', 'CAPE VERDE'] },
    { code: 'KSA', name: 'Saudi Arabia', group: 'H', aliases: ['SAUDI ARABIA'] },
    { code: 'URU', name: 'Uruguay', group: 'H', aliases: ['URUGUAY'] },

    { code: 'FRA', name: 'France', group: 'I', aliases: ['FRANCE'] },
    { code: 'SEN', name: 'Senegal', group: 'I', aliases: ['SENEGAL'] },
    { code: 'IRQ', name: 'Iraq', group: 'I', aliases: ['IRAQ'] },
    { code: 'NOR', name: 'Norway', group: 'I', aliases: ['NORWAY'] },

    { code: 'ARG', name: 'Argentina', group: 'J', aliases: ['ARGENTINA'] },
    { code: 'ALG', name: 'Algeria', group: 'J', aliases: ['ALGERIA'] },
    { code: 'AUT', name: 'Austria', group: 'J', aliases: ['AUSTRIA'] },
    { code: 'JOR', name: 'Jordan', group: 'J', aliases: ['JORDAN'] },

    { code: 'POR', name: 'Portugal', group: 'K', aliases: ['PORTUGAL'] },
    { code: 'COD', name: 'DR Congo', group: 'K', aliases: ['CONGO DR', 'DR CONGO', 'CONGO'] },
    { code: 'UZB', name: 'Uzbekistan', group: 'K', aliases: ['UZBEKISTAN'] },
    { code: 'COL', name: 'Colombia', group: 'K', aliases: ['COLOMBIA'] },

    { code: 'ENG', name: 'England', group: 'L', aliases: ['ENGLAND'] },
    { code: 'CRO', name: 'Croatia', group: 'L', aliases: ['CROATIA'] },
    { code: 'GHA', name: 'Ghana', group: 'L', aliases: ['GHANA'] },
    { code: 'PAN', name: 'Panama', group: 'L', aliases: ['PANAMA'] },
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
