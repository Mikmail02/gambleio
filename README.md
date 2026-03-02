# Gambleio 🎰

A modern, interactive gambling game platform featuring Plinko and Roulette games.

## Features

- 🎯 **Plinko Game** - Drop balls and watch them bounce to win multipliers
- 🎰 **Roulette** - Classic casino-style roulette with betting system
- 👤 **User Authentication** - Local authentication system
- 📊 **Profile Stats** - Track your bets and winnings
- 💰 **Balance System** - Manage your virtual currency
- 🎨 **Modern UI** - Beautiful, responsive design

## Getting Started

### Local Development

1. Clone or download this repository
2. Run the server: `node server.js`
3. Open `http://localhost:3000` in a web browser

### File Structure

```
Gambleio/
├── index.html          # Main HTML file
├── css/
│   └── style.css       # All styles
├── js/
│   ├── auth.js         # Authentication logic
│   ├── game.js         # Game state management
│   ├── main.js         # Main app logic
│   ├── plinko.js       # Plinko game logic
│   └── roulette.js     # Roulette game logic
├── DEPLOYMENT.md       # Deployment guide
└── README.md           # This file
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions on deploying to:
- Netlify (recommended)
- Vercel
- GitHub Pages

## Technologies

- Pure HTML5
- CSS3 (Flexbox, Grid, Animations)
- Vanilla JavaScript (ES6+)
- Canvas API (for Roulette wheel)
- Matter.js (for Plinko physics)

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

This project is for educational purposes.
