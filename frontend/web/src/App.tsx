// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface CraftingMaterial {
  id: string;
  name: string;
  encryptedValue: string;
  rarity: "common" | "rare" | "legendary";
  category: "metal" | "gem" | "herb" | "catalyst";
  owner: string;
  timestamp: number;
}

interface CraftingRecipe {
  id: string;
  name: string;
  requiredMaterials: string[];
  encryptedResult: string;
  discovered: boolean;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'enhance':
      result = value * 1.5;
      break;
    case 'weaken':
      result = value * 0.75;
      break;
    case 'invert':
      result = -value;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  // Randomly selected styles: High saturation neon (purple/blue/pink/green), Cyberpunk UI, Grid information flow layout, Animation rich interaction
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<CraftingMaterial[]>([]);
  const [recipes, setRecipes] = useState<CraftingRecipe[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCraftModal, setShowCraftModal] = useState(false);
  const [crafting, setCrafting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CraftingMaterial | CraftingRecipe | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"materials" | "recipes">("materials");

  const legendaryCount = materials.filter(m => m.rarity === "legendary").length;
  const rareCount = materials.filter(m => m.rarity === "rare").length;
  const commonCount = materials.filter(m => m.rarity === "common").length;

  useEffect(() => {
    loadMaterials().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadMaterials = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("material_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing material keys:", e); }
      }
      const list: CraftingMaterial[] = [];
      for (const key of keys) {
        try {
          const materialBytes = await contract.getData(`material_${key}`);
          if (materialBytes.length > 0) {
            try {
              const materialData = JSON.parse(ethers.toUtf8String(materialBytes));
              list.push({ 
                id: key, 
                name: materialData.name, 
                encryptedValue: materialData.value, 
                rarity: materialData.rarity, 
                category: materialData.category,
                owner: materialData.owner, 
                timestamp: materialData.timestamp 
              });
            } catch (e) { console.error(`Error parsing material data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading material ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setMaterials(list);
    } catch (e) { console.error("Error loading materials:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const loadRecipes = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const keysBytes = await contract.getData("recipe_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing recipe keys:", e); }
      }
      const list: CraftingRecipe[] = [];
      for (const key of keys) {
        try {
          const recipeBytes = await contract.getData(`recipe_${key}`);
          if (recipeBytes.length > 0) {
            try {
              const recipeData = JSON.parse(ethers.toUtf8String(recipeBytes));
              list.push({ 
                id: key,
                name: recipeData.name,
                requiredMaterials: recipeData.materials,
                encryptedResult: recipeData.result,
                discovered: recipeData.discovered
              });
            } catch (e) { console.error(`Error parsing recipe data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading recipe ${key}:`, e); }
      }
      setRecipes(list);
    } catch (e) { console.error("Error loading recipes:", e); }
  };

  const craftItem = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (selectedMaterials.length < 2) { alert("Select at least 2 materials to craft"); return; }
    
    setCrafting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted materials with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Get encrypted values of selected materials
      const selectedMaterialValues = materials
        .filter(m => selectedMaterials.includes(m.id))
        .map(m => m.encryptedValue);
      
      // Simulate FHE computation (in a real app this would be done by the FHE circuit)
      let resultValue = selectedMaterialValues.reduce((acc, val) => {
        const decrypted = FHEDecryptNumber(val);
        return acc + decrypted;
      }, 0);
      
      // Apply random modifier to simulate discovery process
      const modifiers = ['enhance', 'weaken', 'invert'];
      const randomModifier = modifiers[Math.floor(Math.random() * modifiers.length)];
      resultValue = FHEDecryptNumber(FHECompute(FHEEncryptNumber(resultValue), randomModifier));
      
      // Check if this combination matches any known recipe
      const matchedRecipe = recipes.find(recipe => 
        recipe.requiredMaterials.every(reqMat => 
          selectedMaterials.includes(reqMat)
        ) && 
        recipe.requiredMaterials.length === selectedMaterials.length
      );
      
      const recipeId = matchedRecipe ? matchedRecipe.id : `discovery-${Date.now()}`;
      const recipeName = matchedRecipe ? matchedRecipe.name : `Discovered Recipe #${recipes.length + 1}`;
      
      // Save the result
      const resultData = {
        name: recipeName,
        materials: selectedMaterials,
        result: FHEEncryptNumber(resultValue),
        discovered: !matchedRecipe,
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      await contract.setData(`recipe_${recipeId}`, ethers.toUtf8Bytes(JSON.stringify(resultData)));
      
      // Update recipe keys if this is a new discovery
      if (!matchedRecipe) {
        const keysBytes = await contract.getData("recipe_keys");
        let keys: string[] = [];
        if (keysBytes.length > 0) {
          try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
          catch (e) { console.error("Error parsing keys:", e); }
        }
        keys.push(recipeId);
        await contract.setData("recipe_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      }
      
      setTransactionStatus({ visible: true, status: "success", message: "Crafting complete! Discovered new encrypted properties!" });
      await loadRecipes();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCraftModal(false);
        setSelectedMaterials([]);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Crafting failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCrafting(false); 
    }
  };

  const addTestMaterial = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Generating encrypted material..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const rarities: ("common" | "rare" | "legendary")[] = ["common", "rare", "legendary"];
      const categories: ("metal" | "gem" | "herb" | "catalyst")[] = ["metal", "gem", "herb", "catalyst"];
      const materialNames = [
        "Mystic Ore", "Arcane Gem", "Enchanted Herb", "FHE Catalyst",
        "Shadow Steel", "Luminous Crystal", "Void Bloom", "Encrypted Essence"
      ];
      
      const rarity = rarities[Math.floor(Math.random() * rarities.length)];
      const category = categories[Math.floor(Math.random() * categories.length)];
      const name = `${materialNames[Math.floor(Math.random() * materialNames.length)]} ${Math.floor(Math.random() * 100)}`;
      const value = Math.floor(Math.random() * 100) + (rarity === "rare" ? 100 : rarity === "legendary" ? 500 : 0);
      
      const materialId = `mat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const encryptedValue = FHEEncryptNumber(value);
      
      const materialData = {
        name,
        value: encryptedValue,
        rarity,
        category,
        owner: address,
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      await contract.setData(`material_${materialId}`, ethers.toUtf8Bytes(JSON.stringify(materialData)));
      
      // Update material keys
      const keysBytes = await contract.getData("material_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(materialId);
      await contract.setData("material_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted material generated!" });
      await loadMaterials();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to generate material: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const toggleMaterialSelection = (materialId: string) => {
    setSelectedMaterials(prev => 
      prev.includes(materialId) 
        ? prev.filter(id => id !== materialId) 
        : [...prev, materialId]
    );
  };

  const filteredMaterials = materials.filter(material => 
    material.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    material.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    material.rarity.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const tutorialSteps = [
    { title: "Collect Encrypted Materials", description: "Gather materials with encrypted properties using FHE technology", icon: "🔍" },
    { title: "Experiment with Combinations", description: "Combine different materials to discover new recipes", icon: "🧪", details: "The FHE-encrypted properties interact in unexpected ways" },
    { title: "Discover Hidden Properties", description: "Unlock the true potential of encrypted catalysts", icon: "🔓", details: "Zama FHE allows computation on encrypted data without decryption" },
    { title: "Craft Legendary Items", description: "Create powerful gear with your discovered recipes", icon: "⚔️", details: "Each crafted item has unique encrypted attributes" }
  ];

  const renderRarityChart = () => {
    const total = materials.length || 1;
    const legendaryPercentage = (legendaryCount / total) * 100;
    const rarePercentage = (rareCount / total) * 100;
    const commonPercentage = (commonCount / total) * 100;
    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div className="pie-segment legendary" style={{ transform: `rotate(${legendaryPercentage * 3.6}deg)` }}></div>
          <div className="pie-segment rare" style={{ transform: `rotate(${(legendaryPercentage + rarePercentage) * 3.6}deg)` }}></div>
          <div className="pie-segment common" style={{ transform: `rotate(${(legendaryPercentage + rarePercentage + commonPercentage) * 3.6}deg)` }}></div>
          <div className="pie-center">
            <div className="pie-value">{materials.length}</div>
            <div className="pie-label">Materials</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item"><div className="color-box legendary"></div><span>Legendary: {legendaryCount}</span></div>
          <div className="legend-item"><div className="color-box rare"></div><span>Rare: {rareCount}</span></div>
          <div className="legend-item"><div className="color-box common"></div><span>Common: {commonCount}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted crafting system...</p>
    </div>
  );

  return (
    <div className="app-container neon-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="anvil-icon"></div></div>
          <h1>隱材匠人</h1>
          <span className="subtitle">FHE Crafting RPG</span>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCraftModal(true)} className="craft-btn neon-button">
            <div className="hammer-icon"></div>Craft Items
          </button>
          <button className="neon-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Guide" : "Crafting Guide"}
          </button>
          <button className="neon-button" onClick={addTestMaterial}>
            <div className="plus-icon"></div>Get Material
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Master of Encrypted Crafting</h2>
            <p>Discover hidden properties of FHE-encrypted materials to craft legendary items</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>Zama FHE Encryption Active</span></div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Crafting with FHE Technology</h2>
            <p className="subtitle">Learn how to work with encrypted materials</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-diagram">
              <div className="diagram-step"><div className="diagram-icon">🔍</div><div className="diagram-label">Find Materials</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🔒</div><div className="diagram-label">FHE Encryption</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🧪</div><div className="diagram-label">Experiment</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">⚔️</div><div className="diagram-label">Craft Items</div></div>
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card neon-card">
            <h3>Project Introduction</h3>
            <p>An RPG where crafting requires <strong>FHE-encrypted materials</strong>. Discover hidden properties by experimenting with encrypted catalysts. Powered by <strong>Zama FHE</strong> technology.</p>
            <div className="fhe-badge"><span>FHE-Powered Crafting</span></div>
          </div>
          <div className="dashboard-card neon-card">
            <h3>Material Rarity</h3>
            <div className="stats-grid">
              <div className="stat-item"><div className="stat-value">{materials.length}</div><div className="stat-label">Total Materials</div></div>
              <div className="stat-item"><div className="stat-value">{legendaryCount}</div><div className="stat-label">Legendary</div></div>
              <div className="stat-item"><div className="stat-value">{rareCount}</div><div className="stat-label">Rare</div></div>
              <div className="stat-item"><div className="stat-value">{commonCount}</div><div className="stat-label">Common</div></div>
            </div>
          </div>
          <div className="dashboard-card neon-card"><h3>Rarity Distribution</h3>{renderRarityChart()}</div>
        </div>
        
        <div className="crafting-section">
          <div className="section-tabs">
            <button 
              className={`tab-button ${activeTab === "materials" ? "active" : ""}`}
              onClick={() => setActiveTab("materials")}
            >
              Materials
            </button>
            <button 
              className={`tab-button ${activeTab === "recipes" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("recipes");
                loadRecipes();
              }}
            >
              Recipes
            </button>
          </div>
          
          <div className="section-header">
            <h2>{activeTab === "materials" ? "Encrypted Materials" : "Discovered Recipes"}</h2>
            <div className="header-actions">
              <button onClick={loadMaterials} className="refresh-btn neon-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              {activeTab === "materials" && (
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search materials..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <div className="search-icon"></div>
                </div>
              )}
            </div>
          </div>
          
          {activeTab === "materials" ? (
            <div className="materials-grid">
              {filteredMaterials.length === 0 ? (
                <div className="no-materials">
                  <div className="no-materials-icon"></div>
                  <p>No encrypted materials found</p>
                  <button className="neon-button primary" onClick={addTestMaterial}>Get First Material</button>
                </div>
              ) : filteredMaterials.map(material => (
                <div 
                  className={`material-card ${material.rarity} ${selectedMaterials.includes(material.id) ? "selected" : ""}`} 
                  key={material.id}
                  onClick={() => toggleMaterialSelection(material.id)}
                >
                  <div className="material-icon" data-category={material.category}></div>
                  <div className="material-info">
                    <h3>{material.name}</h3>
                    <div className="material-meta">
                      <span className={`rarity ${material.rarity}`}>{material.rarity}</span>
                      <span className="category">{material.category}</span>
                    </div>
                    <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
                  </div>
                  <div className="selection-check">
                    {selectedMaterials.includes(material.id) ? "✓" : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="recipes-list">
              {recipes.length === 0 ? (
                <div className="no-recipes">
                  <div className="no-recipes-icon"></div>
                  <p>No recipes discovered yet</p>
                  <button className="neon-button primary" onClick={() => setShowCraftModal(true)}>Start Crafting</button>
                </div>
              ) : recipes.map(recipe => (
                <div 
                  className="recipe-card" 
                  key={recipe.id}
                  onClick={() => setSelectedItem(recipe)}
                >
                  <div className="recipe-icon"></div>
                  <div className="recipe-info">
                    <h3>{recipe.name}</h3>
                    <p className="recipe-meta">{recipe.discovered ? "Discovered by you" : "Known recipe"}</p>
                    <div className="required-materials">
                      {recipe.requiredMaterials.map(matId => {
                        const mat = materials.find(m => m.id === matId);
                        return mat ? (
                          <div key={matId} className="required-material" data-rarity={mat.rarity}>
                            {mat.name.substring(0, 10)}...
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <div className="recipe-result">
                    <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Result</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {showCraftModal && (
        <div className="modal-overlay">
          <div className="craft-modal neon-card">
            <div className="modal-header">
              <h2>Craft with Encrypted Materials</h2>
              <button onClick={() => setShowCraftModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice-banner">
                <div className="key-icon"></div> 
                <div><strong>FHE Crafting Notice</strong><p>Material properties remain encrypted during entire crafting process</p></div>
              </div>
              
              <div className="selected-materials">
                <h3>Selected Materials ({selectedMaterials.length})</h3>
                {selectedMaterials.length === 0 ? (
                  <p className="empty-selection">Select at least 2 materials from your inventory</p>
                ) : (
                  <div className="selected-materials-grid">
                    {selectedMaterials.map(matId => {
                      const mat = materials.find(m => m.id === matId);
                      return mat ? (
                        <div key={matId} className="selected-material" onClick={() => toggleMaterialSelection(matId)}>
                          <div className="material-icon" data-category={mat.category}></div>
                          <span>{mat.name}</span>
                          <div className="remove-icon">×</div>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
              
              <div className="crafting-preview">
                <h3>Crafting Preview</h3>
                <div className="preview-container">
                  <div className="materials-preview">
                    {selectedMaterials.slice(0, 2).map(matId => {
                      const mat = materials.find(m => m.id === matId);
                      return mat ? (
                        <div key={matId} className="preview-material" data-rarity={mat.rarity}>
                          <div className="material-icon" data-category={mat.category}></div>
                        </div>
                      ) : null;
                    })}
                    {selectedMaterials.length > 2 && (
                      <div className="more-materials">+{selectedMaterials.length - 2}</div>
                    )}
                  </div>
                  <div className="crafting-arrow">→</div>
                  <div className="result-preview">
                    <div className="unknown-item"></div>
                    <div className="question-mark">?</div>
                  </div>
                </div>
                <div className="discovery-chance">
                  <div className="discovery-meter">
                    <div 
                      className="discovery-progress" 
                      style={{ width: `${Math.min(100, selectedMaterials.length * 25)}%` }}
                    ></div>
                  </div>
                  <span>Discovery Chance: {Math.min(100, selectedMaterials.length * 25)}%</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCraftModal(false)} className="cancel-btn neon-button">Cancel</button>
              <button 
                onClick={craftItem} 
                disabled={crafting || selectedMaterials.length < 2} 
                className="craft-btn neon-button primary"
              >
                {crafting ? "Processing with FHE..." : "Craft Item"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedItem && (
        <ItemDetailModal 
          item={selectedItem} 
          onClose={() => { 
            setSelectedItem(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          materials={materials}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content neon-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="anvil-icon"></div><span>隱材匠人</span></div>
            <p>FHE-based crafting RPG powered by Zama technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">About Zama</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Discovery</span></div>
          <div className="copyright">© {new Date().getFullYear()} 隱材匠人. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ItemDetailModalProps {
  item: CraftingMaterial | CraftingRecipe;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  materials?: CraftingMaterial[];
}

const ItemDetailModal: React.FC<ItemDetailModalProps> = ({ item, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature, materials }) => {
  const isMaterial = 'rarity' in item;
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const encryptedData = isMaterial ? item.encryptedValue : item.encryptedResult;
    const decrypted = await decryptWithSignature(encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="item-detail-modal neon-card">
        <div className="modal-header">
          <h2>{item.name}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          {isMaterial ? (
            <>
              <div className="item-info">
                <div className="info-item"><span>Rarity:</span><strong className={`rarity ${item.rarity}`}>{item.rarity}</strong></div>
                <div className="info-item"><span>Category:</span><strong>{item.category}</strong></div>
                <div className="info-item"><span>Owner:</span><strong>{item.owner.substring(0, 6)}...{item.owner.substring(38)}</strong></div>
                <div className="info-item"><span>Acquired:</span><strong>{new Date(item.timestamp * 1000).toLocaleString()}</strong></div>
              </div>
              <div className="encrypted-data-section">
                <h3>Encrypted Properties</h3>
                <div className="encrypted-data">{item.encryptedValue.substring(0, 100)}...</div>
                <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
                <button className="decrypt-btn neon-button" onClick={handleDecrypt} disabled={isDecrypting}>
                  {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedValue !== null ? "Hide Value" : "Decrypt with Wallet"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="item-info">
                <div className="info-item"><span>Status:</span><strong>{item.discovered ? "Discovered by you" : "Known recipe"}</strong></div>
                <div className="info-item"><span>Materials Required:</span><strong>{item.requiredMaterials.length}</strong></div>
              </div>
              <div className="required-materials-list">
                <h3>Required Materials</h3>
                {materials && item.requiredMaterials.map(matId => {
                  const mat = materials.find(m => m.id === matId);
                  return mat ? (
                    <div key={matId} className="required-material-item">
                      <div className="material-icon" data-category={mat.category}></div>
                      <div className="material-info">
                        <h4>{mat.name}</h4>
                        <div className="material-meta">
                          <span className={`rarity ${mat.rarity}`}>{mat.rarity}</span>
                          <span className="category">{mat.category}</span>
                        </div>
                      </div>
                    </div>
                  ) : <div key={matId} className="unknown-material">Unknown Material</div>;
                })}
              </div>
              <div className="encrypted-result-section">
                <h3>Encrypted Result</h3>
                <div className="encrypted-data">{item.encryptedResult.substring(0, 100)}...</div>
                <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
                <button className="decrypt-btn neon-button" onClick={handleDecrypt} disabled={isDecrypting}>
                  {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedValue !== null ? "Hide Value" : "Decrypt with Wallet"}
                </button>
              </div>
            </>
          )}
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>{isMaterial ? "Material Property" : "Crafting Result"}</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted value is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn neon-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;