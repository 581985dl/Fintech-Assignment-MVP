import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, writeBatch, query, increment, serverTimestamp, getDocs, orderBy, limit, addDoc } from 'firebase/firestore';
import { ArrowUpRight, Building, Wallet, UserCircle, CheckCircle, Package, Home, X, LogIn, Landmark, PlusCircle, MinusCircle, Info, Scale, List, BarChart2, Award } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


// --- Firebase Configuration ---
// Replace with your Firebase project configuration
// Replace with your Firebase project configuration
// Replace with your Firebase project configuration

// --- Main App Component ---
export default function App() {
    const [page, setPage] = useState('marketplace');
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [properties, setProperties] = useState([]);
    const [portfolio, setPortfolio] = useState([]);
    const [proposals, setProposals] =useState([]);
    const [transactions, setTransactions] = useState([]);
    const [portfolioHistory, setPortfolioHistory] = useState([]);
    const [selectedProperty, setSelectedProperty] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setAuth(authInstance);
            setDb(dbInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (currentUser) => {
                if (currentUser) {
                    setUser(currentUser);
                    const userDocRef = doc(dbInstance, `artifacts/${appId}/users`, currentUser.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    if (!userDocSnap.exists()) {
                        await setDoc(userDocRef, {
                            cashBalance: 100000, kycStatus: 'Verified', createdAt: serverTimestamp(), userName: 'Guest Investor', role: 'retail_investor'
                        });
                    }
                    setIsLoggedIn(true); 
                } else {
                    setIsLoggedIn(false);
                }
                setIsLoading(false);
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase initialization error:", error);
            setIsLoading(false);
        }
    }, []);

    // --- Data Seeding and Listeners ---
    useEffect(() => {
        if (db && user && isLoggedIn) {
            seedInitialData(db);
            
            const unsubscribers = [
                onSnapshot(doc(db, `artifacts/${appId}/users`, user.uid), (doc) => setUserData(doc.data())),
                onSnapshot(query(collection(db, `artifacts/${appId}/public/data/properties`)), (snapshot) => setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
                onSnapshot(query(collection(db, `artifacts/${appId}/users/${user.uid}/portfolio`)), (snapshot) => setPortfolio(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
                onSnapshot(query(collection(db, `artifacts/${appId}/public/data/proposals`)), (snapshot) => setProposals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
                onSnapshot(query(collection(db, `artifacts/${appId}/users/${user.uid}/transactions`), orderBy('timestamp', 'desc')), (snapshot) => setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
                onSnapshot(query(collection(db, `artifacts/${appId}/users/${user.uid}/portfolioHistory`), orderBy('timestamp', 'asc')), (snapshot) => {
                    const history = snapshot.docs.map(d => {
                        const data = d.data();
                        return { ...data, date: data.timestamp?.toDate().toLocaleDateString() };
                    });
                    setPortfolioHistory(history);
                }),
            ];
            
            // Run simulation checks after initial data load
            if (portfolio.length > 0 && userData && properties.length > 0) {
                 checkForRentalPayouts();
                 recordPortfolioSnapshot();
            }

            return () => unsubscribers.forEach(unsub => unsub());
        }
    }, [db, user, isLoggedIn]);
    
    // --- Simulation Logic ---
    const portfolioValue = useMemo(() => portfolio.reduce((total, holding) => {
        const property = properties.find(p => p.id === holding.id);
        return total + (holding.quantity * (property ? property.tokenPrice : 0));
    }, 0), [portfolio, properties]);

    const checkForRentalPayouts = async () => {
         if (!db || !user || !portfolio.length) return;
        const batch = writeBatch(db);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        for (const holding of portfolio) {
            const lastPayout = holding.lastPayoutDate?.toDate() || new Date(0);
            if (lastPayout < thirtyDaysAgo) {
                const property = properties.find(p => p.id === holding.id);
                if (property) {
                    const rentAmount = holding.quantity * property.monthlyRentPerToken;
                    
                    const userDocRef = doc(db, `artifacts/${appId}/users`, user.uid);
                    batch.update(userDocRef, { cashBalance: increment(rentAmount) });
                    
                    const holdingDocRef = doc(db, `artifacts/${appId}/users/${user.uid}/portfolio`, holding.id);
                    batch.update(holdingDocRef, { lastPayoutDate: serverTimestamp() });
                    
                    const txCollectionRef = collection(db, `artifacts/${appId}/users/${user.uid}/transactions`);
                    addDoc(txCollectionRef, {
                        type: 'Rental Income',
                        amount: rentAmount,
                        description: `${holding.quantity} tokens of ${property.name}`,
                        timestamp: serverTimestamp()
                    });
                }
            }
        }
        await batch.commit().catch(e => console.error("Payout error:", e));
    };
    
    const recordPortfolioSnapshot = async () => {
        if (!db || !user) return;
        const historyRef = collection(db, `artifacts/${appId}/users/${user.uid}/portfolioHistory`);
        const q = query(historyRef, orderBy('timestamp', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        const lastRecord = snapshot.docs[0]?.data();
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        if (!lastRecord || lastRecord.timestamp.toDate() < oneDayAgo) {
            await addDoc(historyRef, {
                value: portfolioValue,
                timestamp: serverTimestamp()
            });
        }
    };

    // --- Core Actions ---
    const handleLogin = async () => { if (auth) await signInAnonymously(auth).catch(e=>console.error(e)); };
    const handleAddCash = async (amount) => {
        if (!db || !user) return;
        const userDocRef = doc(db, `artifacts/${appId}/users`, user.uid);
        await updateDoc(userDocRef, { cashBalance: increment(parseFloat(amount)) });
        await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/transactions`), { type: 'Deposit', amount: parseFloat(amount), description: 'Cash added to account', timestamp: serverTimestamp() });
    };
    const handleCashOut = async (amount) => {
        if (!db || !user || !userData || userData.cashBalance < parseFloat(amount)) { alert("Insufficient funds"); return; }
        const userDocRef = doc(db, `artifacts/${appId}/users`, user.uid);
        await updateDoc(userDocRef, { cashBalance: increment(-parseFloat(amount)) });
        await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/transactions`), { type: 'Withdrawal', amount: -parseFloat(amount), description: 'Cash withdrawn to bank', timestamp: serverTimestamp() });
    };

    const handleBuy = async (property, amount) => {
        if (!db || !user || !userData) return;
        const cost = amount * property.tokenPrice;
        if (userData.cashBalance < cost) { alert("Insufficient funds"); return; }
        const batch = writeBatch(db);
        const userDocRef = doc(db, `artifacts/${appId}/users`, user.uid);
        batch.update(userDocRef, { cashBalance: increment(-cost) });
        batch.update(doc(db, `artifacts/${appId}/public/data/properties`, property.id), { tokensAvailable: increment(-amount) });
        const holdingDocRef = doc(db, `artifacts/${appId}/users/${user.uid}/portfolio`, property.id);
        const holdingDoc = await getDoc(holdingDocRef);
        if (holdingDoc.exists()) batch.update(holdingDocRef, { quantity: increment(amount) });
        else batch.set(holdingDocRef, { propertyName: property.name, quantity: amount, lastPayoutDate: new Date(0) });
        await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/transactions`), { type: 'Purchase', amount: -cost, description: `${amount} tokens of ${property.name}`, timestamp: serverTimestamp() });
        await batch.commit();
        setSelectedProperty(null);
    };

    const handleSell = async (holding) => {
        if (!db || !user || !userData) return;
        const property = properties.find(p => p.id === holding.id);
        const saleValue = holding.quantity * property.tokenPrice;
        const batch = writeBatch(db);
        const userDocRef = doc(db, `artifacts/${appId}/users`, user.uid);
        batch.update(userDocRef, { cashBalance: increment(saleValue) });
        batch.update(doc(db, `artifacts/${appId}/public/data/properties`, holding.id), { tokensAvailable: increment(holding.quantity) });
        batch.delete(doc(db, `artifacts/${appId}/users/${user.uid}/portfolio`, holding.id));
        await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/transactions`), { type: 'Sale', amount: saleValue, description: `${holding.quantity} tokens of ${property.name}`, timestamp: serverTimestamp() });
        await batch.commit();
    };
    
    const handleVote = async (proposalId, vote) => {
        const proposalRef = doc(db, `artifacts/${appId}/public/data/proposals`, proposalId);
        await updateDoc(proposalRef, { [vote]: increment(1) });
        // In a real app, you'd record that this user has voted.
    };
    
    // --- UI Rendering ---
    if (isLoading) return <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center font-sans"><div className="text-center"><Building className="text-indigo-400 h-16 w-16 animate-pulse mx-auto mb-4" /><p className="text-xl text-gray-300">Loading REChain Platform...</p></div></div>;
    if (!isLoggedIn) return <LoginPage onLogin={handleLogin} />;
    
    return (
        <div className="bg-gray-900 text-white font-sans min-h-screen flex">
            <Sidebar page={page} setPage={setPage} />
            <main className="flex-1 p-4 sm:p-8 ml-16 sm:ml-64">
                <Header userData={userData} portfolioValue={portfolioValue} />
                {page === 'marketplace' && <Marketplace properties={properties} onSelect={setSelectedProperty} />}
                {page === 'portfolio' && <Portfolio portfolio={portfolio} properties={properties} onSell={handleSell} history={portfolioHistory} />}
                {page === 'governance' && <GovernancePage proposals={proposals} portfolio={portfolio} onVote={handleVote} />}
                {page === 'profile' && <ProfilePage user={user} userData={userData} onAddCash={handleAddCash} onCashOut={handleCashOut} transactions={transactions}/>}
            </main>
            {selectedProperty && <BuyModal property={selectedProperty} onClose={() => setSelectedProperty(null)} onBuy={handleBuy} userBalance={userData?.cashBalance || 0} />}
        </div>
    );
}

// --- Page & Major Components ---

function LoginPage({ onLogin }) { return <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center font-sans p-4"><div className="text-center max-w-lg"><Building className="text-indigo-400 h-20 w-20 mx-auto mb-6" /><h1 className="text-5xl font-bold text-white mb-4">Welcome to REChain</h1><p className="text-xl text-gray-300 mb-8">The future of fractional real estate investment.</p><button onClick={onLogin} className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-500 transition-all duration-300 transform hover:scale-105 text-lg flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/30"><LogIn className="mr-3 h-5 w-5" />Enter as Guest Investor</button><p className="text-xs text-gray-500 mt-8">This is an MVP demonstration. All data is simulated.</p></div></div>; }
function Marketplace({ properties, onSelect }) { return (<div><h2 className="text-2xl font-semibold text-gray-200 mb-4">Available Properties</h2><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{properties.map(prop => (<PropertyCard key={prop.id} property={prop} onSelect={onSelect} />))}</div></div>); }

function Portfolio({ portfolio, properties, onSell, history }) {
    const portfolioWithValue = useMemo(() => portfolio.map(holding => {
        const property = properties.find(p => p.id === holding.id);
        return { ...holding, currentValue: holding.quantity * (property ? property.tokenPrice : 0), tokenPrice: property?.tokenPrice || 0, imageUrl: property?.imageUrl, location: property?.location };
    }), [portfolio, properties]);

    return (
        <div>
            <h2 className="text-2xl font-semibold text-gray-200 mb-4">Portfolio Overview</h2>
            <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
                <h3 className="text-lg font-bold text-white mb-4">Portfolio Value Over Time</h3>
                <div style={{height: 300}}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={history} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} >
                             <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                            <XAxis dataKey="date" stroke="#a0aec0" />
                            <YAxis stroke="#a0aec0" tickFormatter={(value) => `€${value.toLocaleString()}`}/>
                            <Tooltip contentStyle={{ backgroundColor: '#2d3748', border: 'none' }} labelStyle={{ color: '#a0aec0' }} formatter={(value) => `€${value.toLocaleString()}`}/>
                            <Legend />
                            <Line type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 8 }} name="Portfolio Value" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
            
            <h2 className="text-2xl font-semibold text-gray-200 mb-4">Your Holdings</h2>
            {portfolioWithValue.length === 0 ? <div className="text-center py-20 bg-gray-800 rounded-lg"><Package className="mx-auto text-gray-500 h-12 w-12 mb-4" /><h2 className="text-2xl font-semibold text-white">Your Portfolio is Empty</h2></div>
            : <div className="bg-gray-800 rounded-lg shadow-lg"><ul className="divide-y divide-gray-700">{portfolioWithValue.map(h => (<li key={h.id} className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4"><div className="flex items-center w-full sm:w-auto"><img src={h.imageUrl} alt={h.propertyName} className="h-16 w-16 rounded-md object-cover mr-4" onError={(e)=>{e.target.src='https://placehold.co/100x100/1f2937/7c3aed?text=P'}}/><div className="flex-grow"><h4 className="font-bold text-lg text-white">{h.propertyName}</h4><p className="text-sm text-gray-400">{h.location}</p><p className="text-sm text-indigo-400">{h.quantity.toLocaleString()} Tokens</p></div></div><div className="flex items-center space-x-6 w-full sm:w-auto"><div className="text-right flex-grow"><p className="text-sm text-gray-400">Current Value</p><p className="font-bold text-lg text-white">€{h.currentValue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><p className="text-xs text-gray-500">(@ €{h.tokenPrice.toFixed(2)}/token)</p></div><button onClick={() => onSell(h)} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-500 transition-colors">Sell All</button></div></li>))}</ul></div>}
        </div>
    );
}

function GovernancePage({ proposals, portfolio, onVote }) {
    const userHoldings = useMemo(() => portfolio.reduce((acc, h) => ({...acc, [h.id]: h.quantity}), {}), [portfolio]);

    return(
        <div>
            <h2 className="text-2xl font-semibold text-gray-200 mb-6">Governance Proposals</h2>
             <div className="space-y-6">
                {proposals.map(p => {
                    const totalVotes = p.yes + p.no;
                    const canVote = userHoldings[p.propertyId] > 0;
                    return (
                        <div key={p.id} className="bg-gray-800 rounded-lg shadow-lg p-6">
                            <p className="text-sm text-indigo-400 font-bold">{p.propertyName}</p>
                            <h3 className="text-xl font-bold text-white mt-1 mb-2">{p.title}</h3>
                            <p className="text-gray-400 mb-4">{p.description}</p>
                            <div className="mb-4">
                                <div className="flex justify-between mb-1 text-sm"><span className="text-green-400">Yes</span><span>{p.yes} votes</span></div>
                                <div className="w-full bg-gray-700 rounded-full h-2.5"><div className="bg-green-500 h-2.5 rounded-full" style={{width: `${totalVotes > 0 ? (p.yes/totalVotes)*100 : 0}%`}}></div></div>
                                <div className="flex justify-between mt-2 mb-1 text-sm"><span className="text-red-400">No</span><span>{p.no} votes</span></div>
                                <div className="w-full bg-gray-700 rounded-full h-2.5"><div className="bg-red-500 h-2.5 rounded-full" style={{width: `${totalVotes > 0 ? (p.no/totalVotes)*100 : 0}%`}}></div></div>
                            </div>
                            {canVote ? 
                                <div className="flex gap-4 border-t border-gray-700 pt-4 mt-4">
                                    <button onClick={() => onVote(p.id, 'yes')} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">Vote Yes</button>
                                    <button onClick={() => onVote(p.id, 'no')} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">Vote No</button>
                                </div>
                                : <p className="text-sm text-center text-gray-500 border-t border-gray-700 pt-4 mt-4">You must own tokens for this property to vote.</p>
                            }
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ProfilePage({ user, userData, onAddCash, onCashOut, transactions }) {
    const [profileTab, setProfileTab] = useState('details');

    return (
        <div>
            <h2 className="text-2xl font-semibold text-gray-200 mb-6">Your Profile</h2>
            <div className="flex border-b border-gray-700 mb-6">
                <button onClick={() => setProfileTab('details')} className={`px-4 py-2 font-medium text-sm ${profileTab === 'details' ? 'border-b-2 border-indigo-400 text-white' : 'text-gray-400'}`}>Account</button>
                <button onClick={() => setProfileTab('transactions')} className={`px-4 py-2 font-medium text-sm ${profileTab === 'transactions' ? 'border-b-2 border-indigo-400 text-white' : 'text-gray-400'}`}>Transactions</button>
            </div>

            {profileTab === 'details' && <AccountDetails user={user} userData={userData} onAddCash={onAddCash} onCashOut={onCashOut} />}
            {profileTab === 'transactions' && <TransactionList transactions={transactions} />}
        </div>
    );
}


// --- Sub-components & Helpers ---

function Sidebar({ page, setPage }) {
    const navItems = [
        { id: 'marketplace', icon: Home, label: 'Marketplace' },
        { id: 'portfolio', icon: Package, label: 'Portfolio' },
        { id: 'governance', icon: Scale, label: 'Governance' },
        { id: 'profile', icon: UserCircle, label: 'Profile' }
    ];
    return <nav className="fixed top-0 left-0 h-full bg-gray-900 border-r border-gray-700 w-16 sm:w-64 flex flex-col items-center sm:items-start p-2 sm:p-4 transition-all duration-300 z-10"><div className="flex items-center mb-10 w-full justify-center sm:justify-start"><Building className="text-indigo-400 h-8 w-8" /><span className="hidden sm:inline text-xl font-bold ml-2 text-white">REChain</span></div><ul className="space-y-2 w-full">{navItems.map(item => (<li key={item.id}><button onClick={() => setPage(item.id)} className={`flex items-center p-3 rounded-lg w-full justify-center sm:justify-start transition-colors ${page === item.id ? 'bg-indigo-500 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}><item.icon className="h-5 w-5" /><span className="hidden sm:inline ml-4 font-medium">{item.label}</span></button></li>))}</ul></nav>;
}

function Header({ userData, portfolioValue }) {
    return (
        <header className="mb-8"><div className="flex justify-between items-center flex-wrap gap-4"><h1 className="text-3xl font-bold text-white">Investor Dashboard</h1><div className="flex items-center space-x-2 sm:space-x-4"><div className="flex items-center space-x-2 bg-gray-800 p-2 rounded-lg"><Wallet className="text-indigo-400 h-6 w-6" /><div><div className="text-xs text-gray-400">Cash</div><div className="font-bold text-sm text-white">€{userData?.cashBalance?.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}</div></div></div><div className="flex items-center space-x-2 bg-gray-800 p-2 rounded-lg"><Package className="text-green-400 h-6 w-6" /><div><div className="text-xs text-gray-400">Portfolio</div><div className="font-bold text-sm text-white">€{portfolioValue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div></div></div></header>
    );
}

function PropertyCard({ property, onSelect }) {
    return (
        <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 flex flex-col"><img src={property.imageUrl} alt={property.name} className="w-full h-48 object-cover" onError={(e)=>{e.target.src='https://placehold.co/600x400/1f2937/7c3aed?text=Property'}}/><div className="p-4 flex flex-col flex-grow"><h3 className="text-xl font-bold text-white">{property.name}</h3><p className="text-gray-400 text-sm mb-2">{property.location}</p><div className="text-sm text-gray-300 mb-4 border-t border-b border-gray-700 py-2">Total Value: <span className="font-bold text-white">€{property.totalValue.toLocaleString('de-DE')}</span></div><div className="flex justify-between items-center text-sm mb-4"><div className="text-center"><div className="text-gray-400">Token Price</div><div className="text-white font-semibold">€{property.tokenPrice.toFixed(2)}</div></div><div className="text-center"><div className="text-gray-400">Est. Yield</div><div className="text-green-400 font-semibold">{property.annualYield}%</div></div><div className="text-center"><div className="text-gray-400">Tokens Left</div><div className="text-white font-semibold">{property.tokensAvailable.toLocaleString()}</div></div></div><button onClick={() => onSelect(property)} className="w-full mt-auto bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-500 transition-colors flex items-center justify-center">View & Invest <ArrowUpRight className="ml-2 h-4 w-4" /></button></div></div>
    );
}

function BuyModal({ property, onClose, onBuy, userBalance }) {
    const [amount, setAmount] = useState(1);
    const totalCost = amount * property.tokenPrice;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg shadow-xl p-8 w-full max-w-lg relative"><button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X /></button><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><img src={property.imageUrl} alt={property.name} className="w-full h-48 object-cover rounded-lg mb-4" onError={(e)=>{e.target.src='https://placehold.co/600x400/1f2937/7c3aed?text=Property'}}/><h2 className="text-2xl font-bold text-white mb-1">{property.name}</h2><p className="text-gray-400 text-sm mb-4">{property.location}</p>{property.endorsement && <div className="bg-indigo-900/50 border border-indigo-700 rounded-lg p-3 mb-4"><p className="text-sm text-indigo-300 flex items-center"><Award className="w-4 h-4 mr-2"/>Certified Investor Note</p><p className="text-xs text-indigo-200 mt-2">"{property.endorsement.quote}"</p><p className="text-xs text-right text-indigo-400 font-bold mt-1">- {property.endorsement.name}</p></div>} <div className="bg-gray-900 rounded-lg p-3 mb-4"><p className="text-sm text-gray-300 flex items-center"><Info className="w-4 h-4 mr-2 text-indigo-400"/>Project Overview</p><p className="text-xs text-gray-400 mt-2">{property.description}</p></div></div><div><div className="bg-gray-900 rounded-lg p-4 mb-4"><div className="flex justify-between text-sm mb-2"><span className="text-gray-400">Total Property Value</span><span className="text-white font-mono">€{property.totalValue.toLocaleString('de-DE')}</span></div><div className="flex justify-between text-sm mb-2"><span className="text-gray-400">Token Price</span><span className="text-white font-mono">€{property.tokenPrice.toFixed(2)}</span></div><div className="flex justify-between text-sm mb-2"><span className="text-gray-400">Est. Annual Yield</span><span className="text-green-400 font-mono">{property.annualYield}%</span></div><div className="flex justify-between text-sm"><span className="text-gray-400">Tokens Available</span><span className="text-white font-mono">{property.tokensAvailable.toLocaleString()}</span></div></div><div className="mb-4"><label htmlFor="buy-amount" className="block text-sm font-medium text-gray-300 mb-2">How many tokens to buy?</label><input type="number" id="buy-amount" value={amount} onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))} className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg p-2 text-center text-lg font-bold" min="1" max={property.tokensAvailable}/></div><div className="bg-gray-700 rounded-lg p-3 text-center mb-4"><p className="text-sm text-gray-400">Total Cost</p><p className="text-2xl font-bold text-indigo-400">€{totalCost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><p className="text-xs text-center text-gray-500 mb-4">Your Balance: €{userBalance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><button onClick={() => onBuy(property, amount)} disabled={totalCost > userBalance || amount > property.tokensAvailable} className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-500 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed">Confirm Purchase</button></div></div></div></div>
    );
}

function AccountDetails({ user, userData, onAddCash, onCashOut }) {
    const [addAmount, setAddAmount] = useState('');
    const [cashOutAmount, setCashOutAmount] = useState('');
    const handleAddSubmit = (e) => { e.preventDefault(); onAddCash(addAmount); setAddAmount(''); };
    const handleCashOutSubmit = (e) => { e.preventDefault(); onCashOut(cashOutAmount); setCashOutAmount(''); };
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-gray-800 rounded-lg shadow-lg p-6"><h3 className="font-bold text-xl mb-4 text-white">Account Details</h3><div className="space-y-4"><div className="flex items-center space-x-3"><UserCircle className="w-8 h-8 text-indigo-400"/><div><p className="text-sm text-gray-400">Username</p><p className="font-mono text-white">{userData?.userName}</p></div></div><div className="flex items-center space-x-3"><CheckCircle className="w-8 h-8 text-green-400"/><div><p className="text-sm text-gray-400">KYC Status</p><p className="font-bold text-green-400">{userData?.kycStatus}</p></div></div><div><p className="text-sm text-gray-400 mt-4">User ID</p><p className="font-mono text-xs text-gray-500 break-all">{user?.uid}</p></div></div></div>
            <div className="bg-gray-800 rounded-lg shadow-lg p-6"><h3 className="font-bold text-xl mb-4 text-white">Manage Funds</h3><form onSubmit={handleAddSubmit} className="space-y-3 mb-6"><label className="block text-sm font-medium text-gray-300">Add Cash (Simulated)</label><div className="flex gap-2"><input type="number" placeholder="Amount in €" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg p-2" min="1" step="0.01"/><button type="submit" className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-500 transition-colors flex items-center"><PlusCircle className="w-5 h-5 mr-2"/>Add</button></div></form><form onSubmit={handleCashOutSubmit} className="space-y-3"><label className="block text-sm font-medium text-gray-300">Cash Out to Bank (Simulated)</label><div className="flex gap-2"><input type="number" placeholder="Amount in €" value={cashOutAmount} onChange={(e) => setCashOutAmount(e.target.value)} className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg p-2" min="1" step="0.01"/><button type="submit" className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-500 transition-colors flex items-center"><MinusCircle className="w-5 h-5 mr-2"/>Cash Out</button></div></form></div>
        </div>
    );
}

function TransactionList({ transactions }) {
    if (transactions.length === 0) return <div className="text-center py-20 bg-gray-800 rounded-lg"><List className="mx-auto text-gray-500 h-12 w-12 mb-4" /><h2 className="text-2xl font-semibold text-white">No Transactions Yet</h2><p className="text-gray-400 mt-2">Your transaction history will appear here.</p></div>;
    return(
        <div className="bg-gray-800 rounded-lg shadow-lg">
            <ul className="divide-y divide-gray-700">
                {transactions.map(tx => (
                    <li key={tx.id} className="p-4 flex items-center justify-between">
                        <div>
                            <span className={`font-bold ${tx.type === 'Rental Income' || tx.type === 'Sale' || tx.type === 'Deposit' ? 'text-green-400' : 'text-red-400'}`}>{tx.type}</span>
                            <p className="text-sm text-gray-400">{tx.description}</p>
                        </div>
                        <div className="text-right">
                             <span className={`font-mono text-lg ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>{tx.amount > 0 ? '+' : ''}€{tx.amount.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            <p className="text-xs text-gray-500">{tx.timestamp?.toDate().toLocaleString()}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// --- Firestore Data Seeding Utility ---
async function seedInitialData(db) {
    const propertiesRef = collection(db, `artifacts/${appId}/public/data/properties`);
    const docSnap = await getDoc(doc(propertiesRef, 'amsterdam-canal-house'));
    if (docSnap.exists()) return;

    console.log("Seeding initial database data...");
    const batch = writeBatch(db);

    const propertiesToSeed = [
        { id: 'amsterdam-canal-house', name: 'Amsterdam Canal House', location: 'Prinsengracht, Amsterdam', totalValue: 2500000, tokenPrice: 100, tokensAvailable: 25000, annualYield: 4.5, monthlyRentPerToken: 0.37, imageUrl: 'https://images.unsplash.com/photo-1582234038529-67f708945091?q=80&w=800', description: 'A historic 17th-century canal house. Stable rental income from long-term tenants in a prime location.' },
        { id: 'rotterdam-penthouse', name: 'Rotterdam Modern Penthouse', location: 'Wijnhaven, Rotterdam', totalValue: 1200000, tokenPrice: 120, tokensAvailable: 10000, annualYield: 5.2, monthlyRentPerToken: 0.52, imageUrl: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=800', description: 'Luxury penthouse in a new high-rise with panoramic city views. Poised for significant value appreciation.', endorsement: { name: 'A. van der Meer', quote: 'This is a cornerstone asset for any modern real estate portfolio. Strong growth potential.' } },
        { id: 'utrecht-historic-loft', name: 'Utrecht Historic Loft', location: 'Oudegracht, Utrecht', totalValue: 750000, tokenPrice: 75, tokensAvailable: 10000, annualYield: 4.8, monthlyRentPerToken: 0.30, imageUrl: 'https://images.unsplash.com/photo-1613553422385-2313645a8a4f?q=80&w=800', description: 'Charming loft conversion in a former warehouse. Attracts high demand from young professionals.'},
        { id: 'the-hague-residence', name: 'The Hague Royal Residence', location: 'Lange Voorhout, The Hague', totalValue: 4000000, tokenPrice: 200, tokensAvailable: 20000, annualYield: 4.1, monthlyRentPerToken: 0.68, imageUrl: 'https://images.unsplash.com/photo-1594488942095-3c115c54533a?q=80&w=800', description: 'An elegant residential building in the diplomatic heart of The Hague. Premium asset offering security and prestige.'},
    ];
    propertiesToSeed.forEach(prop => {
        const { id, ...data } = prop;
        batch.set(doc(propertiesRef, id), data);
    });

    const proposalsRef = collection(db, `artifacts/${appId}/public/data/proposals`);
    batch.set(doc(proposalsRef), {
        propertyId: 'rotterdam-penthouse',
        propertyName: 'Rotterdam Modern Penthouse',
        title: 'Approve new tenant for Penthouse Unit 10A?',
        description: 'A corporate client has proposed a 2-year lease for unit 10A at 5% above the current market rate. The tenant is a highly-rated international firm.',
        yes: 1250,
        no: 120
    });
    
    await batch.commit();
    console.log("Database seeded.");
}
