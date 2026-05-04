use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: {} <password>", args[0]);
        std::process::exit(1);
    }

    let password = &args[1];

    match bcrypt::hash(password, bcrypt::DEFAULT_COST) {
        Ok(hashed) => {
            println!("Password Hash:\n{}", hashed);
            println!("\nSet this in your environment:");
            println!("export ADMIN_PASSWORD_HASH='{}'", hashed);
        }
        Err(e) => {
            eprintln!("Failed to hash password: {}", e);
            std::process::exit(1);
        }
    }
}
