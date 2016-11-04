---
layout: post
title: First post!
subtitle: Each post also has a subtitle
published: true
---

This is my first post, how exciting!

```
    //Builder pattern.
    class Program
    {
        public static void Main()
        {
            Customer customer = new CustomerBuilder().WithName("MookieFumi").IsVip(true).Build();

            Console.ReadKey();
        }
    }

    class CustomerBuilder
    {
        private readonly Customer _customer;

        public CustomerBuilder()
        {
            _customer = new Customer();
        }

        public CustomerBuilder WithName(string name)
        {
            _customer.Name = name;
            return this;
        }

        public CustomerBuilder IsVip(bool vip)
        {
            _customer.Type = vip ? ClientType.Vip : ClientType.NoVip;
            return this;
        }

        public Customer Build()
        {
            return _customer;
        }
    }

    class Customer
    {
        public Guid CustomerId { get; set; }
        public string Name { get; set; }
        public ClientType Type { get; set; }
    }

    enum ClientType
    {
        NoVip = 1,
        Vip = 2
    }
```