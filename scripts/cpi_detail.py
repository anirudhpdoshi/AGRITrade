"""US CPI by category (BLS CPI-U item indexes). m/m from seasonally adjusted (CUSR0000), 12-month from not adjusted (CUUR0000), as BLS reports them.
Group tags let the desk show the internals: aggregates, food, energy, core goods, core services."""
CPI_ITEMS = [
    # (item code, label, group)
    ("SA0", "All items", "agg"), ("SA0L1E", "Core (ex food & energy)", "agg"), ("SAF1", "Food", "agg"), ("SA0E", "Energy", "agg"),
    ("SACL1E", "Core goods", "agg"), ("SASLE", "Core services", "agg"),
    ("SAF11", "Food at home", "food"), ("SEFV", "Food away from home", "food"), ("SAF111", "Cereals & bakery products", "food"),
    ("SEFA", "Cereals & cereal products", "food"), ("SEFB", "Bakery products", "food"), ("SAF112", "Meats, poultry, fish & eggs", "food"),
    ("SEFC", "Beef & veal", "food"), ("SEFF", "Chicken", "food"), ("SEFH", "Eggs", "food"), ("SEFJ", "Dairy products", "food"),
    ("SAF113", "Fruits & vegetables", "food"), ("SEFK", "Fresh fruits", "food"), ("SEFL", "Fresh vegetables", "food"),
    ("SEFL02", "Lettuce", "food"), ("SEFL03", "Tomatoes", "food"), ("SAF114", "Nonalcoholic beverages", "food"), ("SEFP01", "Coffee", "food"),
    ("SEFR", "Sugar & sweets", "food"), ("SEFS", "Fats & oils", "food"), ("SAF116", "Alcoholic beverages", "food"),
    ("SETB01", "Gasoline", "energy"), ("SEHE01", "Fuel oil", "energy"), ("SEHF01", "Electricity", "energy"), ("SEHF02", "Utility (piped) gas", "energy"),
    ("SETA01", "New vehicles", "goods"), ("SETA02", "Used cars & trucks", "goods"), ("SAA", "Apparel", "goods"),
    ("SAM1", "Medical care commodities", "goods"), ("SAH3", "Household furnishings & operations", "goods"), ("SERA01", "Televisions", "goods"),
    ("SEGA", "Tobacco & smoking products", "goods"),
    ("SAH1", "Shelter", "services"), ("SEHA", "Rent of primary residence", "services"), ("SEHC", "Owners' equivalent rent", "services"),
    ("SEHB", "Lodging away from home", "services"), ("SAM2", "Medical care services", "services"), ("SEMD", "Hospital services", "services"),
    ("SEMC01", "Physicians' services", "services"), ("SETE", "Motor vehicle insurance", "services"), ("SETD", "Motor vehicle maintenance & repair", "services"),
    ("SETG01", "Airline fares", "services"), ("SAS4", "Transportation services", "services"), ("SEHG", "Water, sewer & trash", "services"),
    ("SAE", "Education & communication", "services"), ("SAR", "Recreation", "services"),
]

# Canada — Statistics Canada table 18-10-0004-01 (CPI, monthly, not seasonally adjusted; Geography 2 = Canada).
# (product member id, label, group). Seasonally adjusted data exist only for the 8 main components, so both reads are NSA, as StatCan headlines them.
CA_ITEMS = [
    (2, "All items", "agg"), (285, "All items ex food & energy", "agg"), (3, "Food", "agg"), (288, "Energy", "agg"), (274, "Goods", "agg"), (282, "Services", "agg"),
    (79, "Shelter", "main"), (176, "Transportation", "main"), (96, "Household operations & furnishings", "main"), (139, "Clothing & footwear", "main"),
    (201, "Health & personal care", "main"), (219, "Recreation, education & reading", "main"), (256, "Alcohol, tobacco & cannabis", "main"),
    (4, "Food purchased from stores", "food"), (75, "Food from restaurants", "food"), (29, "Bakery & cereal products", "food"), (30, "Bakery products", "food"),
    (34, "Cereal products", "food"), (5, "Meat", "food"), (7, "Fresh or frozen beef", "food"), (11, "Fresh or frozen chicken", "food"), (22, "Dairy products", "food"),
    (28, "Eggs", "food"), (40, "Fresh fruit", "food"), (50, "Fresh vegetables", "food"), (53, "Lettuce", "food"), (59, "Sugar & confectionery", "food"),
    (62, "Edible fats & oils", "food"), (66, "Coffee", "food"),
    (184, "Gasoline", "energy"), (92, "Electricity", "energy"), (94, "Natural gas", "energy"), (95, "Fuel oil & other fuels", "energy"),
    (180, "Purchase of passenger vehicles", "goods"), (233, "Home entertainment equipment & services", "goods"),
    (81, "Rent", "services"), (85, "Mortgage interest cost", "services"), (84, "Owned accommodation", "services"), (189, "Vehicle insurance premiums", "services"),
    (199, "Air transportation", "services"), (241, "Traveller accommodation", "services"), (249, "Tuition fees", "services"), (99, "Telephone services", "services"), (93, "Water", "services"),
]
