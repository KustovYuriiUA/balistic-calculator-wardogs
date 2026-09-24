// Public Wardogs Zone map metadata; attribution: maps/SOURCES.md
const MAP_LANDMARKS = {
  "kavkazi": {
    "rotations": [
      {
        "id": "bakurani",
        "name": "Bakurani",
        "towns": [
          "Baghi",
          "Chuta",
          "Khevuli"
        ]
      },
      {
        "id": "mindori",
        "name": "Mindori",
        "towns": [
          "Baghi",
          "Khevuli",
          "Liknisi"
        ]
      },
      {
        "id": "tevza",
        "name": "Tevza",
        "towns": [
          "Edemi",
          "Shovli",
          "Vostimi"
        ]
      }
    ],
    "spawns": [
      {
        "pos": [
          0.3285,
          0.6012
        ],
        "faction": "manticore",
        "town": "Liknisi"
      },
      {
        "pos": [
          0.2455,
          0.5292
        ],
        "faction": "manticore",
        "town": "Chuta"
      },
      {
        "pos": [
          0.7208,
          0.571
        ],
        "faction": "valkyra",
        "town": "Khevuli"
      },
      {
        "pos": [
          0.5293,
          0.7992
        ],
        "faction": "lonestar",
        "town": "Baghi"
      }
    ],
    "zones": [
      {
        "id": "bakurani-default",
        "name": "Default",
        "rotation": "bakurani",
        "pos": [
          0.4877,
          0.5617
        ],
        "radiusM": 500
      },
      {
        "id": "bakurani-farmland",
        "name": "Farmland",
        "rotation": "bakurani",
        "pos": [
          0.4966,
          0.5767
        ],
        "radiusM": 500
      },
      {
        "id": "bakurani-lumberyard",
        "name": "Lumberyard",
        "rotation": "bakurani",
        "pos": [
          0.5035,
          0.5617
        ],
        "radiusM": 500
      }
    ]
  },
  "europe": {
    "rotations": [
      {
        "id": "berlin",
        "name": "Berlin",
        "towns": [
          "Bremen",
          "Hanover",
          "Stuttgart"
        ]
      },
      {
        "id": "madrid",
        "name": "Madrid",
        "towns": [
          "Barcelona",
          "Granada",
          "Malaga"
        ]
      },
      {
        "id": "paris",
        "name": "Paris",
        "towns": [
          "Calais",
          "Granada",
          "Rennes"
        ]
      }
    ],
    "spawns": [
      {
        "pos": [
          0.5397,
          0.5415
        ],
        "faction": "manticore",
        "town": "Stuttgart"
      },
      {
        "pos": [
          0.2712,
          0.6352
        ],
        "faction": "manticore",
        "town": "Calais"
      },
      {
        "pos": [
          0.8391,
          0.5915
        ],
        "faction": "valkyra",
        "town": "Barcelona"
      },
      {
        "pos": [
          0.4216,
          0.4633
        ],
        "faction": "manticore",
        "town": "Malaga"
      },
      {
        "pos": [
          0.5345,
          0.3786
        ],
        "faction": "valkyra",
        "town": "Rennes"
      },
      {
        "pos": [
          0.5667,
          0.7546
        ],
        "faction": "lonestar",
        "town": "Hanover"
      },
      {
        "pos": [
          0.5113,
          0.8085
        ],
        "faction": "lonestar",
        "town": "Granada"
      },
      {
        "pos": [
          0.741,
          0.8416
        ],
        "faction": "valkyra",
        "town": "Bremen"
      }
    ],
    "zones": [
      {
        "id": "paris-default",
        "name": "Default",
        "rotation": "paris",
        "pos": [
          0.479,
          0.5617
        ],
        "radiusM": 550
      },
      {
        "id": "ozeti-default",
        "name": "Default",
        "rotation": "madrid",
        "pos": [
          0.6104,
          0.6123
        ],
        "radiusM": 550
      },
      {
        "id": "ozeti-farmland",
        "name": "Farmland",
        "rotation": "madrid",
        "pos": [
          0.5779,
          0.6122
        ],
        "radiusM": 550
      },
      {
        "id": "ozeti-church",
        "name": "Church",
        "rotation": "madrid",
        "pos": [
          0.6203,
          0.6142
        ],
        "radiusM": 550
      },
      {
        "id": "ozeti-river",
        "name": "River",
        "rotation": "madrid",
        "pos": [
          0.5965,
          0.6192
        ],
        "radiusM": 550
      }
    ]
  },
  "northamerica": {
    "rotations": [
      {
        "id": "detroit",
        "name": "Detroit",
        "towns": [
          "Austin",
          "Boston",
          "Chicago"
        ]
      }
    ],
    "spawns": [
      {
        "pos": [
          0.2407,
          0.2374
        ],
        "faction": "valkyra",
        "town": "Austin"
      },
      {
        "pos": [
          0.6388,
          0.2976
        ],
        "faction": "manticore",
        "town": "Chicago"
      },
      {
        "pos": [
          0.4151,
          0.5935
        ],
        "faction": "lonestar",
        "town": "Boston"
      }
    ],
    "zones": [
      {
        "id": "zestafona-default",
        "name": "Default",
        "rotation": "detroit",
        "pos": [
          0.4312,
          0.3711
        ],
        "radiusM": 500
      },
      {
        "id": "zestafona-smallfactory",
        "name": "Small Factory",
        "rotation": "detroit",
        "pos": [
          0.4344,
          0.3561
        ],
        "radiusM": 500
      },
      {
        "id": "zestafona-watertreatment",
        "name": "Water Treatment",
        "rotation": "detroit",
        "pos": [
          0.4272,
          0.3877
        ],
        "radiusM": 500
      },
      {
        "id": "zestafona-houses",
        "name": "Houses",
        "rotation": "detroit",
        "pos": [
          0.4207,
          0.3651
        ],
        "radiusM": 500
      }
    ]
  }
};
