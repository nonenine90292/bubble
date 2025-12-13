const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/enviar-codigo", async (req, res) => {
    const { email } = req.body;
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: "elvismanuelmontero3@gmail.com",
            pass: "lqgj qcpa bigy kgzu"
        }
    });

    await transporter.sendMail({
        from: "Verificación <elvismanuelmontero3@gmail.com>",
        to: email,
        subject: "Código de verificación",
        html: `<h2>Tu código es: <b>${codigo}</b></h2>`
    });

    res.json({ codigo });
});

app.listen(3000, () => {
    console.log("Servidor activo en http://localhost:3000");
});