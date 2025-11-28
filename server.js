const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// --- ROUTE: GET PROPERTIES ---
app.get('/api/properties', async (req, res) => {
  const { postcode } = req.query;
  
  if (!postcode) return res.status(400).json({ error: "Postcode required" });

  const cleanPostcode = postcode.toUpperCase().replace(/\s+/g, ' ').trim(); 
  const postcodeSector = cleanPostcode.split(' ').length > 1 
      ? cleanPostcode.substring(0, cleanPostcode.length - 2).trim() 
      : cleanPostcode;

  console.log(`Searching for: ${cleanPostcode}`);

  try {
    // 1. Fetch Land Registry Data (With Timeout)
    // We try EXACT match first.
    let sparqlQuery = `
      prefix lrcommon: <http://landregistry.data.gov.uk/def/common/>
      prefix lrppi: <http://landregistry.data.gov.uk/def/ppi/>
      prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      prefix xsd: <http://www.w3.org/2001/XMLSchema#>

      SELECT ?date ?price ?paon ?saon ?street ?type WHERE {
        ?transx lrppi:pricePaid ?price ;
                lrppi:transactionDate ?date ;
                lrppi:propertyType ?typeRef ;
                lrppi:propertyAddress ?addr .
        ?typeRef rdfs:label ?type .
        ?addr lrcommon:postcode "${cleanPostcode.replace(/\s/g, '')}"^^xsd:string .
        OPTIONAL { ?addr lrcommon:paon ?paon }
        OPTIONAL { ?addr lrcommon:saon ?saon }
        OPTIONAL { ?addr lrcommon:street ?street }
      } ORDER BY DESC(?date) LIMIT 50
    `;

    let landRegUrl = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
    
    // Timeout set to 5 seconds
    let landRegResponse = await axios.get(landRegUrl, { timeout: 5000 });
    let sales = landRegResponse.data.results.bindings;

    // 2. Fallback: If no exact results, search the Sector (e.g. GU25 4)
    if (sales.length === 0) {
        console.log("No exact match. Switching to Sector Search...");
        sparqlQuery = `
          prefix lrcommon: <http://landregistry.data.gov.uk/def/common/>
          prefix lrppi: <http://landregistry.data.gov.uk/def/ppi/>
          prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
          prefix xsd: <http://www.w3.org/2001/XMLSchema#>

          SELECT ?date ?price ?paon ?saon ?street ?type ?postcode WHERE {
            ?transx lrppi:pricePaid ?price ;
                    lrppi:transactionDate ?date ;
                    lrppi:propertyType ?typeRef ;
                    lrppi:propertyAddress ?addr .
            ?typeRef rdfs:label ?type .
            ?addr lrcommon:postcode ?postcode .
            FILTER(REGEX(?postcode, "^${postcodeSector.replace(/\s/g, '')}", "i"))
            OPTIONAL { ?addr lrcommon:paon ?paon }
            OPTIONAL { ?addr lrcommon:saon ?saon }
            OPTIONAL { ?addr lrcommon:street ?street }
          } ORDER BY DESC(?date) LIMIT 20
        `;
        landRegUrl = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
        landRegResponse = await axios.get(landRegUrl, { timeout: 8000 });
        sales = landRegResponse.data.results.bindings;
    }

    // 3. Format Data (EPC DISABLED to prevent crashes)
    const results = sales.map((sale, index) => {
       const paon = sale.paon ? sale.paon.value : '';
       const saon = sale.saon ? sale.saon.value : '';
       const street = sale.street ? sale.street.value : '';
       const addressString = `${saon} ${paon} ${street}`.trim();
       
       return {
         id: `prop_${index}_${Date.now()}`,
         address: addressString || "Unknown Address",
         city: "London", 
         postcode: sale.postcode ? sale.postcode.value : cleanPostcode,
         type: sale.type.value,
         lastSoldPrice: parseInt(sale.price.value),
         lastSoldDate: sale.date.value,
         sqMeters: 90, // Default size for now
         epc: 'N/A'
       };
    });

    res.json(results);

  } catch (error) {
    console.error("Backend Error:", error.message);
    // Send empty list so frontend doesn't hang
    res.json([]); 
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
